import {describe, expect, it} from 'bun:test';

import type {PlatformId} from '../../base/common/platformId';
import {AuthorityLevel, GlobalBotStaffTier} from '../../core/auth/authorityLevel';
import {CommandRegistry} from '../../core/commands/commandRegistry';
import {createEventBus} from '../../core/events/eventBus';
import {createGuildHierarchyCache} from '../../core/hierarchy/guildHierarchyCache';
import {parseCommandArgs} from '../../core/parser/commandParser';
import {BUILTIN_SHORT_ALIASES} from '../../core/parser/commandPrecedence';
import {createFakeChannelPort} from '../../core/ports/testing/fakeChannel.port';
import {FakeMessagingPort} from '../../core/ports/testing/fakeMessaging.port';
import {createFakeModerationPort} from '../../core/ports/testing/fakeModeration.port';
import {createStructuredLogger} from '../../platform/logger/structuredLogger';
import type {ModLogEntry, ModLogService} from '../logging/modLog.contract';
import {MemorySecurityStore, type SecurityService} from '../security/security.contract';
import {createMemoryHoneypotStore} from './honeypot.contract';
import {createHoneypotModule} from './honeypot.module';

function createStubSecurity(
  securityStore: MemorySecurityStore,
  actingOwnerId?: string,
): SecurityService {
  return {
    isBotOwner: () => false,
    resolveBotStaffTier: async () => Promise.resolve({tier: GlobalBotStaffTier.None, nodes: []}),
    resolveActorLevel: async opts => {
      if (opts.guildOwnerId !== undefined && opts.userId === opts.guildOwnerId) {
        return AuthorityLevel.TrueOwner;
      }
      if (actingOwnerId !== undefined && opts.userId === actingOwnerId) {
        return AuthorityLevel.ActingOwner;
      }
      const snap = await securityStore.getGuildSecuritySnapshot(opts.platform, opts.guildId);
      if (opts.roleIds.some(r => snap.boundAdminRoleIds.has(r))) {
        return AuthorityLevel.BoundAdmin;
      }
      if (opts.roleIds.some(r => snap.boundStaffRoleIds.has(r))) {
        return AuthorityLevel.BoundStaff;
      }
      return AuthorityLevel.Member;
    },
    authorize: async () => Promise.reject(new Error('authorize not used in honeypot unit harness')),
    assertEpochUnchanged: async () => Promise.resolve(true),
    invalidateGuildCache: async () => Promise.resolve(),
    flushAllCaches: () => undefined,
    recordStateChangeAndCheckVelocity: async () =>
      Promise.resolve({tripped: false, reason: undefined}),
    store: securityStore,
    registerCommands: () => undefined,
  };
}

function setupHoneypotHarness(options: {setupTimeoutMs?: number; actingOwnerId?: string} = {}) {
  const securityStore = new MemorySecurityStore();
  const honeypotStore = createMemoryHoneypotStore();
  const messagingPort = new FakeMessagingPort();
  const moderationPort = createFakeModerationPort();
  const channelPort = createFakeChannelPort();
  const eventBus = createEventBus();
  const hierarchyCache = createGuildHierarchyCache({eventBus});
  const logger = createStructuredLogger({minLevel: 'error', prettyConsole: false});
  const modLogEntries: ModLogEntry[] = [];
  const modLog: ModLogService = {
    logAction: async entry => {
      modLogEntries.push(entry);
      await Promise.resolve();
    },
  };
  const security = createStubSecurity(securityStore, options.actingOwnerId);
  const commandRegistry = new CommandRegistry();

  const honeypot = createHoneypotModule({
    store: honeypotStore,
    security,
    modLog,
    channelPort,
    messagingPort,
    moderationPort,
    eventBus,
    hierarchyCache,
    logger,
    setupTimeoutMs: options.setupTimeoutMs,
  });
  honeypot.registerCommands(commandRegistry);

  return {
    commandRegistry,
    securityStore,
    honeypotStore,
    messagingPort,
    moderationPort,
    channelPort,
    eventBus,
    hierarchyCache,
    modLogEntries,
    honeypot,
    registerChannel: (guildId: string, channelId: string) => {
      channelPort.channels.set(channelId, {
        id: channelId,
        guildId,
        type: 0,
        name: 'general',
      });
    },
    invokeCommand: async (opts: {
      readonly platform?: PlatformId;
      readonly commandName: string;
      readonly guildId: string;
      readonly channelId: string;
      readonly actorId: string;
      readonly rawArgs?: string;
    }) => {
      const def = commandRegistry.get(opts.commandName);
      if (def === undefined) {
        throw new Error(`Command not found: ${opts.commandName}`);
      }
      const replies: string[] = [];
      const rawArgs = opts.rawArgs ?? '';
      await def.execute({
        platform: opts.platform ?? 'discord',
        guildId: opts.guildId,
        channelId: opts.channelId,
        actorId: opts.actorId,
        actorRoleIds: [],
        guildOwnerId: opts.actorId,
        rawArgs,
        parsed: parseCommandArgs(rawArgs),
        isSudo: false,
        reply: async msg => {
          replies.push(msg);
          await Promise.resolve();
        },
      });
      return replies;
    },
    emitMessage: async (opts: {
      readonly platform?: PlatformId;
      readonly guildId: string;
      readonly channelId: string;
      readonly messageId: string;
      readonly authorId: string;
      readonly roleIds?: readonly string[];
      readonly content: string;
    }) => {
      await eventBus.publishRawBatch({
        events: [
          {
            platform: opts.platform ?? 'discord',
            shardId: 0,
            eventType: 'MESSAGE_CREATE',
            rawJson: JSON.stringify({
              id: opts.messageId,
              guild_id: opts.guildId,
              channel_id: opts.channelId,
              content: opts.content,
              author: {id: opts.authorId, bot: false},
              member: {roles: opts.roleIds ?? []},
            }),
          },
        ],
        droppedCount: 0,
      });
    },
  };
}

describe('HoneypotModule', () => {
  it('registers canonical subcommands without polluting top-level listNames and resolves aliases', () => {
    const h = setupHoneypotHarness();
    const canonical = ['honeypot', 'honeypot remove', 'honeypot status', 'honeypot log'];
    expect([...h.commandRegistry.listNames()].sort()).toEqual([...canonical].sort());
    expect(BUILTIN_SHORT_ALIASES.hp).toBe('honeypot');
    for (const alias of [
      'honeypot setup',
      'honeypot s',
      'honeypot rm',
      'honeypot del',
      'honeypot info',
      ...canonical,
    ]) {
      expect(h.commandRegistry.get(alias)).toBeDefined();
    }
    h.hierarchyCache.dispose();
    h.honeypot.dispose();
  });

  it('supports 3-step interactive setup (duration, channel msg, DM msg) and re-run edit', async () => {
    const h = setupHoneypotHarness();
    const guildId = '111111111111111111';
    const ownerId = '222222222222222222';
    const invokeChannelId = '333333333333333333';
    h.registerChannel(guildId, invokeChannelId);

    const replies = await h.invokeCommand({
      commandName: 'honeypot s',
      guildId,
      channelId: invokeChannelId,
      actorId: ownerId,
    });
    expect(replies[0]).toContain('Step 1/3');
    // auto-created top-level honeypot channel with default @everyone permissions
    expect(h.channelPort.channels.size).toBe(2);

    await h.emitMessage({
      guildId,
      channelId: invokeChannelId,
      messageId: '400000000000000001',
      authorId: ownerId,
      content: '12h',
    });
    expect(h.messagingPort.sent.at(-1)?.content).toContain('Step 2/3');

    await h.emitMessage({
      guildId,
      channelId: invokeChannelId,
      messageId: '400000000000000002',
      authorId: ownerId,
      content: 'skip',
    });
    expect(h.messagingPort.sent.at(-1)?.content).toContain('Step 3/3');

    await h.emitMessage({
      guildId,
      channelId: invokeChannelId,
      messageId: '400000000000000003',
      authorId: ownerId,
      content: 'Custom kick DM for {$communityName}: {$inviteUrl}',
    });

    const cfg = await h.honeypotStore.getConfig('discord', guildId);
    expect(cfg?.action).toBe('softban');
    expect(cfg?.deleteMessageSeconds).toBe(43_200);
    expect(cfg?.channelId).toBeDefined();
    expect(cfg?.channelId).not.toBe(invokeChannelId);
    expect(cfg?.customMessage).toBeUndefined();
    expect(cfg?.dmMessage).toBe('Custom kick DM for {$communityName}: {$inviteUrl}');
    expect(cfg?.warningMessageId).toBeDefined();

    const baitChannelId = cfg?.channelId ?? '';
    const ch = h.channelPort.channels.get(baitChannelId);
    expect(ch?.name).toBe('honeypot');
    expect(ch?.topic).toContain('DO NOT SEND A MESSAGE HERE');
    expect(ch?.topic).toContain('Discord');
    expect(ch?.topic).toContain('kick you from the server');
    const everyoneOverwrite = h.channelPort.overwrites.get(`${baitChannelId}:${guildId}`);
    expect(everyoneOverwrite).toBeDefined();
    expect(everyoneOverwrite?.targetType).toBe('role');
    expect((BigInt(everyoneOverwrite?.allowBits ?? '0') & (1n << 10n)) !== 0n).toBe(true); // VIEW_CHANNEL
    expect((BigInt(everyoneOverwrite?.allowBits ?? '0') & (1n << 11n)) !== 0n).toBe(true); // SEND_MESSAGES
    expect((BigInt(everyoneOverwrite?.allowBits ?? '0') & (1n << 14n)) !== 0n).toBe(true); // EMBED_LINKS
    expect((BigInt(everyoneOverwrite?.allowBits ?? '0') & (1n << 15n)) !== 0n).toBe(true); // ATTACH_FILES
    expect((BigInt(everyoneOverwrite?.allowBits ?? '0') & (1n << 16n)) !== 0n).toBe(true); // READ_MESSAGE_HISTORY
    expect((BigInt(everyoneOverwrite?.allowBits ?? '0') & (1n << 18n)) !== 0n).toBe(true); // USE_EXTERNAL_EMOJIS
    expect((BigInt(everyoneOverwrite?.allowBits ?? '0') & (1n << 37n)) !== 0n).toBe(true); // USE_EXTERNAL_STICKERS
    expect((BigInt(everyoneOverwrite?.allowBits ?? '0') & (1n << 6n)) !== 0n).toBe(false); // ADD_REACTIONS not allowed
    expect((BigInt(everyoneOverwrite?.denyBits ?? '0') & (1n << 6n)) !== 0n).toBe(true); // ADD_REACTIONS denied
    expect((BigInt(everyoneOverwrite?.denyBits ?? '0') & (1n << 17n)) !== 0n).toBe(true); // MENTION_EVERYONE denied
    expect((BigInt(everyoneOverwrite?.denyBits ?? '0') & (1n << 13n)) !== 0n).toBe(true); // MANAGE_MESSAGES denied

    // re-running honeypot setup reuses existing channelId without creating a duplicate
    const rerunReplies = await h.invokeCommand({
      commandName: 'honeypot setup',
      guildId,
      channelId: invokeChannelId,
      actorId: ownerId,
    });
    expect(rerunReplies[0]).toContain('Existing Honeypot Setup Found');
    expect(h.channelPort.channels.size).toBe(2);

    await h.emitMessage({
      guildId,
      channelId: invokeChannelId,
      messageId: '400000000000000004',
      authorId: ownerId,
      content: '2d',
    });
    await h.emitMessage({
      guildId,
      channelId: invokeChannelId,
      messageId: '400000000000000005',
      authorId: ownerId,
      content: 'keep',
    });
    await h.emitMessage({
      guildId,
      channelId: invokeChannelId,
      messageId: '400000000000000006',
      authorId: ownerId,
      content: 'keep',
    });

    const updated = await h.honeypotStore.getConfig('discord', guildId);
    expect(updated?.channelId).toBe(baitChannelId);
    expect(updated?.deleteMessageSeconds).toBe(172_800);
    expect(updated?.dmMessage).toBe('Custom kick DM for {$communityName}: {$inviteUrl}');
    h.hierarchyCache.dispose();
    h.honeypot.dispose();
  });

  it('rejects cross-guild channels, invalid durations (>7d), and >1024-char custom messages', async () => {
    const h = setupHoneypotHarness();
    const guildId = '111111111111111111';
    const otherGuildId = '999999999999999998';
    const ownerId = '222222222222222222';
    const baitChannelId = '333333333333333333';
    const foreignChannelId = '333333333333333399';
    h.registerChannel(guildId, baitChannelId);
    h.registerChannel(otherGuildId, foreignChannelId);

    const setupForeign = await h.invokeCommand({
      commandName: 'honeypot setup',
      guildId,
      channelId: baitChannelId,
      actorId: ownerId,
      rawArgs: foreignChannelId,
    });
    expect(setupForeign[0]).toContain('must exist in this server');

    const logForeign = await h.invokeCommand({
      commandName: 'honeypot log',
      guildId,
      channelId: baitChannelId,
      actorId: ownerId,
      rawArgs: `<#${foreignChannelId}>`,
    });
    expect(logForeign[0]).toContain('must exist in this server');

    await h.invokeCommand({
      commandName: 'honeypot setup',
      guildId,
      channelId: baitChannelId,
      actorId: ownerId,
    });
    await h.emitMessage({
      guildId,
      channelId: baitChannelId,
      messageId: '400000000000000007',
      authorId: ownerId,
      content: '10d',
    });
    expect(h.messagingPort.sent.at(-1)?.content).toContain('between `0s` and `7d`');

    await h.emitMessage({
      guildId,
      channelId: baitChannelId,
      messageId: '400000000000000008',
      authorId: ownerId,
      content: '0s',
    });
    await h.emitMessage({
      guildId,
      channelId: baitChannelId,
      messageId: '400000000000000009',
      authorId: ownerId,
      content: 'x'.repeat(1025),
    });
    expect(h.messagingPort.sent.at(-1)?.content).toContain('1024 characters');

    await h.emitMessage({
      guildId,
      channelId: baitChannelId,
      messageId: '400000000000000010',
      authorId: ownerId,
      content: 'No typing here ({$platform} / {$action})',
    });
    await h.emitMessage({
      guildId,
      channelId: baitChannelId,
      messageId: '400000000000000011',
      authorId: ownerId,
      content: 'skip',
    });

    const cfg = await h.honeypotStore.getConfig('discord', guildId);
    expect(cfg?.deleteMessageSeconds).toBe(0);
    expect(cfg?.customMessage).toBe('No typing here ({$platform} / {$action})');
    expect(h.channelPort.channels.get(cfg?.channelId ?? '')?.topic).toBe(
      'No typing here (Discord / kick)',
    );
    h.hierarchyCache.dispose();
    h.honeypot.dispose();
  });

  it('cancels setup when the 60s window expires', async () => {
    const h = setupHoneypotHarness({setupTimeoutMs: 20});
    const guildId = '111111111111111111';
    const ownerId = '222222222222222222';
    const channelId = '333333333333333333';
    h.registerChannel(guildId, channelId);

    await h.invokeCommand({
      commandName: 'honeypot setup',
      guildId,
      channelId,
      actorId: ownerId,
    });

    await new Promise(resolve => setTimeout(resolve, 45));
    expect(h.messagingPort.sent.some(m => m.content.includes('timed out after 60s'))).toBe(true);
    expect(await h.honeypotStore.getConfig('discord', guildId)).toBeUndefined();
    h.honeypot.dispose();
  });

  it('deduplicates burst spam, sanitizes modlog mentions, and excludes Staff/Admin/ActingOwner', async () => {
    const actingOwnerId = '777777777777777777';
    const h = setupHoneypotHarness({actingOwnerId});
    const guildId = '111111111111111111';
    const ownerId = '222222222222222222';
    const baitChannelId = '333333333333333333';
    const staffRoleId = '555555555555555555';
    const adminRoleId = '666666666666666666';
    const spammerId = '888888888888888888';

    await h.honeypotStore.upsertConfig({
      platform: 'discord',
      guildId,
      channelId: baitChannelId,
      action: 'softban',
      deleteMessageSeconds: 86_400,
      customMessage: undefined,
      dmMessage: undefined,
      warningMessageId: 'msg_warn_1',
      counterMessageId: 'msg_counter_1',
      enabled: true,
    });

    await h.securityStore.toggleStaffRole({
      platform: 'discord',
      guildId,
      roleId: staffRoleId,
      tier: 'staff',
      actorId: ownerId,
    });
    await h.securityStore.toggleStaffRole({
      platform: 'discord',
      guildId,
      roleId: adminRoleId,
      tier: 'admin',
      actorId: ownerId,
    });

    // staff, admin, acting owner are excluded
    await h.emitMessage({
      guildId,
      channelId: baitChannelId,
      messageId: '400000000000000010',
      authorId: '100000000000000001',
      roleIds: [staffRoleId],
      content: 'staff check',
    });
    await h.emitMessage({
      guildId,
      channelId: baitChannelId,
      messageId: '400000000000000011',
      authorId: '100000000000000002',
      roleIds: [adminRoleId],
      content: 'admin check',
    });
    await h.emitMessage({
      guildId,
      channelId: baitChannelId,
      messageId: '400000000000000012',
      authorId: actingOwnerId,
      content: 'ao check',
    });
    expect(h.moderationPort.calls.length).toBe(0);

    // burst of 2 messages from spammer -> both deleted, but only 1 ban & 1 count increment
    await Promise.all([
      h.emitMessage({
        guildId,
        channelId: baitChannelId,
        messageId: '400000000000000098',
        authorId: spammerId,
        content: '@everyone `free nitro` http://scam.example',
      }),
      h.emitMessage({
        guildId,
        channelId: baitChannelId,
        messageId: '400000000000000099',
        authorId: spammerId,
        content: '@here second spam',
      }),
    ]);

    expect(h.messagingPort.deleted.length).toBe(2);
    expect(h.moderationPort.calls.length).toBe(2);
    expect(h.moderationPort.calls[0]?.action).toBe('ban');
    expect(h.moderationPort.calls[0]?.deleteMessageSeconds).toBe(86_400);
    expect(h.moderationPort.calls[1]?.action).toBe('unban');
    expect(h.modLogEntries.length).toBe(1);
    expect(h.modLogEntries[0]?.action).toBe('softban');
    expect(h.modLogEntries[0]?.details).not.toContain('@everyone');
    expect(h.modLogEntries[0]?.details).toContain('@\u200beveryone');

    const after = await h.honeypotStore.getConfig('discord', guildId);
    expect(after?.detectionCount).toBe(1);
    expect(h.messagingPort.edited.at(-1)?.messageId).toBe('msg_counter_1');
    expect(h.messagingPort.edited.at(-1)?.content).toBe('## Detection Count: **1**');
    h.honeypot.dispose();
  });

  it('works end-to-end on Fluxer (3-step setup, softban + bot invite DM, status, log, remove)', async () => {
    const h = setupHoneypotHarness();
    const guildId = '111111111111111112';
    const ownerId = '222222222222222223';
    const baitChannelId = '333333333333333334';
    const logChannelId = '333333333333333335';
    const spammerId = '888888888888888889';
    h.registerChannel(guildId, baitChannelId);
    h.registerChannel(guildId, logChannelId);

    await h.invokeCommand({
      platform: 'fluxer',
      commandName: 'honeypot s',
      guildId,
      channelId: baitChannelId,
      actorId: ownerId,
    });
    await h.emitMessage({
      platform: 'fluxer',
      guildId,
      channelId: baitChannelId,
      messageId: '400000000000000101',
      authorId: ownerId,
      content: '6h',
    });
    await h.emitMessage({
      platform: 'fluxer',
      guildId,
      channelId: baitChannelId,
      messageId: '400000000000000102',
      authorId: ownerId,
      content: 'skip',
    });
    await h.emitMessage({
      platform: 'fluxer',
      guildId,
      channelId: baitChannelId,
      messageId: '400000000000000103',
      authorId: ownerId,
      content: 'skip',
    });

    const fluxerCfg = await h.honeypotStore.getConfig('fluxer', guildId);
    const createdBaitChannelId = fluxerCfg?.channelId ?? '';
    const ch = h.channelPort.channels.get(createdBaitChannelId);
    expect(ch?.name).toBe('honeypot');
    expect(ch?.topic).toContain('Fluxer');

    await h.invokeCommand({
      platform: 'fluxer',
      commandName: 'honeypot log',
      guildId,
      channelId: baitChannelId,
      actorId: ownerId,
      rawArgs: `<#${logChannelId}>`,
    });

    await h.emitMessage({
      platform: 'fluxer',
      guildId,
      channelId: createdBaitChannelId,
      messageId: '400000000000000104',
      authorId: spammerId,
      content: 'fluxer spam',
    });

    expect(h.moderationPort.calls[0]?.platform).toBe('fluxer');
    expect(h.moderationPort.calls[0]?.action).toBe('ban');
    expect(h.moderationPort.calls[0]?.deleteMessageSeconds).toBe(21_600);
    expect(h.moderationPort.calls[1]?.action).toBe('unban');
    expect(
      h.messagingPort.sent.some(
        m =>
          m.kind === 'dm' &&
          m.platform === 'fluxer' &&
          m.targetId === spammerId &&
          m.content ===
            'We suspect your account has been compromised, so you have been removed from this server.\nYou can rejoin using: https://fluxer.gg/sleek1',
      ),
    ).toBe(true);
    expect(h.modLogEntries[0]?.channelId).toBe(logChannelId);

    const statusReplies = await h.invokeCommand({
      platform: 'fluxer',
      commandName: 'honeypot info',
      guildId,
      channelId: baitChannelId,
      actorId: ownerId,
    });
    expect(statusReplies[0]).toContain('Detections: **1**');

    const removeReplies = await h.invokeCommand({
      platform: 'fluxer',
      commandName: 'honeypot del',
      guildId,
      channelId: baitChannelId,
      actorId: ownerId,
    });
    expect(removeReplies[0]).toContain('removed');
    expect(await h.honeypotStore.getConfig('fluxer', guildId)).toBeUndefined();
    expect(h.channelPort.channels.has(createdBaitChannelId)).toBe(false);
    h.hierarchyCache.dispose();
    h.honeypot.dispose();
  });

  it('syncs warning message when channel description is updated via CHANNEL_UPDATE', async () => {
    const h = setupHoneypotHarness();
    const guildId = '111111111111111111';
    const baitChannelId = '333333333333333333';

    await h.honeypotStore.upsertConfig({
      platform: 'discord',
      guildId,
      channelId: baitChannelId,
      action: 'softban',
      deleteMessageSeconds: 86_400,
      customMessage: undefined,
      dmMessage: undefined,
      warningMessageId: 'msg_warn_1',
      counterMessageId: 'msg_counter_1',
      enabled: true,
    });

    await h.eventBus.publishRawBatch({
      events: [
        {
          platform: 'discord',
          shardId: 0,
          eventType: 'CHANNEL_UPDATE',
          rawJson: JSON.stringify({
            id: baitChannelId,
            guild_id: guildId,
            topic: 'Updated trap description for {$platform} ({$action})',
          }),
        },
      ],
      droppedCount: 0,
    });

    expect(h.messagingPort.edited.at(-1)?.messageId).toBe('msg_warn_1');
    expect(h.messagingPort.edited.at(-1)?.content).toBe(
      'Updated trap description for Discord (kick)',
    );
    const cfg = await h.honeypotStore.getConfig('discord', guildId);
    expect(cfg?.customMessage).toBe('Updated trap description for {$platform} ({$action})');

    await h.emitMessage({
      platform: 'discord',
      guildId,
      channelId: baitChannelId,
      messageId: '400000000000000199',
      authorId: '888888888888888892',
      content: 'trigger after topic edit',
    });
    expect(h.messagingPort.edited.at(-1)?.messageId).toBe('msg_counter_1');
    expect(h.messagingPort.edited.at(-1)?.content).toBe('## Detection Count: **1**');
    h.hierarchyCache.dispose();
    h.honeypot.dispose();
  });

  it('syncs warning message on Fluxer CHANNEL_UPDATE, uses vanity URL + custom DM, and handles invite failure fallback', async () => {
    const h = setupHoneypotHarness();
    const guildId = '111111111111111113';
    const baitChannelId = '333333333333333336';

    await h.honeypotStore.upsertConfig({
      platform: 'fluxer',
      guildId,
      channelId: baitChannelId,
      action: 'softban',
      deleteMessageSeconds: 3600,
      customMessage: undefined,
      dmMessage: 'Heads up! Kicked from {$communityName}. Rejoin here: {$inviteUrl}',
      warningMessageId: 'msg_warn_fluxer',
      counterMessageId: 'msg_counter_fluxer',
      enabled: true,
    });

    await h.eventBus.publishRawBatch({
      events: [
        {
          platform: 'fluxer',
          shardId: 0,
          eventType: 'GUILD_CREATE',
          rawJson: JSON.stringify({
            id: guildId,
            properties: {
              name: 'Sleek Community',
              vanity_url_code: 'sleek-vip',
              owner_id: '222222222222222223',
            },
            roles: [],
          }),
        },
        {
          platform: 'fluxer',
          shardId: 0,
          eventType: 'CHANNEL_UPDATE',
          rawJson: JSON.stringify({
            id: baitChannelId,
            guild_id: guildId,
            topic: 'Fluxer trap ({$platform} / {$action}) [{$detection_count}]',
          }),
        },
      ],
      droppedCount: 0,
    });

    await h.eventBus.publishRawBatch({
      events: [
        {
          platform: 'fluxer',
          shardId: 0,
          eventType: 'MESSAGE_CREATE',
          rawJson: JSON.stringify({
            id: '400000000000000201',
            guild_id: guildId,
            channel_id: baitChannelId,
            content: 'hello from fluxer',
            author: {id: '888888888888888890', bot: null},
            member: null,
          }),
        },
      ],
      droppedCount: 0,
    });

    expect(h.hierarchyCache.getGuildOwnerId('fluxer', guildId)).toBe('222222222222222223');
    expect(h.messagingPort.edited[0]?.platform).toBe('fluxer');
    expect(h.messagingPort.edited[0]?.content).toBe('Fluxer trap (Fluxer / kick) [0]');
    expect(
      h.messagingPort.sent.some(
        m =>
          m.kind === 'dm' &&
          m.platform === 'fluxer' &&
          m.targetId === '888888888888888890' &&
          m.content ===
            'Heads up! Kicked from Sleek Community. Rejoin here: https://fluxer.gg/sleek-vip',
      ),
    ).toBe(true);
    expect(h.moderationPort.calls[0]?.platform).toBe('fluxer');
    expect(h.moderationPort.calls[0]?.action).toBe('ban');
    expect(h.moderationPort.calls[0]?.deleteMessageSeconds).toBe(3600);
    expect(h.moderationPort.calls[1]?.action).toBe('unban');
    expect(h.messagingPort.edited.at(-1)?.messageId).toBe('msg_counter_fluxer');
    expect(h.messagingPort.edited.at(-1)?.content).toBe('## Detection Count: **1**');

    // also verify fallback when no vanity URL and invite creation fails
    const otherGuildId = '111111111111111114';
    const otherChannelId = '333333333333333337';
    h.channelPort.setCreateInviteFailure({
      code: 'forbidden',
      message: 'Missing CREATE_INSTANT_INVITE',
    });
    await h.honeypotStore.upsertConfig({
      platform: 'discord',
      guildId: otherGuildId,
      channelId: otherChannelId,
      action: 'softban',
      deleteMessageSeconds: 604_800,
      customMessage: undefined,
      dmMessage: undefined,
      enabled: true,
    });
    await h.emitMessage({
      platform: 'discord',
      guildId: otherGuildId,
      channelId: otherChannelId,
      messageId: '400000000000000202',
      authorId: '888888888888888891',
      content: 'no invite fallback',
    });
    expect(
      h.messagingPort.sent.some(
        m =>
          m.kind === 'dm' &&
          m.platform === 'discord' &&
          m.targetId === '888888888888888891' &&
          m.content ===
            'We suspect your account has been compromised, so you have been removed from this server.',
      ),
    ).toBe(true);

    h.hierarchyCache.dispose();
    h.honeypot.dispose();
  });
});
