import {DisposableStore} from '../../base/common/disposable';
import type {PlatformId} from '../../base/common/platformId';
import {AuthorityLevel} from '../../core/auth/authorityLevel';
import type {CommandInvocationContext, CommandRegistry} from '../../core/commands/commandRegistry';
import type {EventBus} from '../../core/events/eventBus';
import type {GuildHierarchyCache} from '../../core/hierarchy/guildHierarchyCache';
import type {ChannelPort} from '../../core/ports/channel.port';
import type {MessagingPort} from '../../core/ports/messaging.port';
import type {ModerationPort} from '../../core/ports/moderation.port';
import {formatDurationCompact, parseDurationMs} from '../../core/parser/durationParser';
import {TieredCache} from '../../platform/cache/tieredCache';
import type {StructuredLogger} from '../../platform/logger/structuredLogger';
import type {ModLogService} from '../logging/modLog.contract';
import type {SecurityService} from '../security/security.contract';
import type {HoneypotConfig, HoneypotModule, HoneypotStore} from './honeypot.contract';
import type {HoneypotAction} from './schema/honeypot.table';

const DEFAULT_SETUP_TIMEOUT_MS = 60_000;
const CHANNEL_TOPIC_MAX_LENGTH = 1024;
const DM_MESSAGE_MAX_LENGTH = 1500;
const DEFAULT_BAN_DELETE_SECONDS = 604_800;
const MAX_BAN_DELETE_SECONDS = 604_800;
const ENFORCEMENT_DEDUPE_TTL_MS = 10_000;
const HONEYPOT_EVERYONE_ALLOW_BITS = String(
  (1n << 10n) | // VIEW_CHANNEL
    (1n << 11n) | // SEND_MESSAGES
    (1n << 14n) | // EMBED_LINKS
    (1n << 15n) | // ATTACH_FILES
    (1n << 16n) | // READ_MESSAGE_HISTORY
    (1n << 18n) | // USE_EXTERNAL_EMOJIS
    (1n << 37n), // USE_EXTERNAL_STICKERS
);
const HONEYPOT_EVERYONE_DENY_BITS = String(
  (1n << 0n) | // CREATE_INSTANT_INVITE
    (1n << 4n) | // MANAGE_CHANNELS
    (1n << 6n) | // ADD_REACTIONS
    (1n << 12n) | // SEND_TTS_MESSAGES
    (1n << 13n) | // MANAGE_MESSAGES
    (1n << 17n) | // MENTION_EVERYONE
    (1n << 28n) | // MANAGE_ROLES
    (1n << 29n) | // MANAGE_WEBHOOKS
    (1n << 31n) | // USE_APPLICATION_COMMANDS
    (1n << 34n) | // MANAGE_THREADS
    (1n << 35n) | // CREATE_PUBLIC_THREADS
    (1n << 36n) | // CREATE_PRIVATE_THREADS
    (1n << 38n) | // SEND_MESSAGES_IN_THREADS
    (1n << 46n) | // SEND_VOICE_MESSAGES
    (1n << 49n) | // SEND_POLLS
    (1n << 50n) | // USE_EXTERNAL_APPS
    (1n << 51n) | // PIN_MESSAGES
    (1n << 52n), // BYPASS_SLOWMODE
);

const DEFAULT_HONEYPOT_TEMPLATE = [
  '# DO NOT SEND A MESSAGE HERE',
  '**🇺🇸 / 🇬🇧 :** This channel is meant to catch hacked {$platform} accounts and notify them. Sending a message here will {$action} you from the server.',
  '',
  '**🇮🇳 :** यह चैनल हैक किए गए {$platform} खातों का पता लगाने और उन्हें सूचित करने के लिए है। यहाँ संदेश भेजने पर आपको सर्वर से {$action} कर दिया जाएगा।',
  '> -# Yeh channel hack hue {$platform} accounts ka pata lagane aur unhe batane ke liye hai. Yahan message karne se aap server se {$action} ho sakte ho.',
  '',
  '**🇩🇪 :** Dieser Kanal dient dazu, gehackte {$platform}-Konten zu identifizieren und deren Besitzer zu benachrichtigen. Wenn Sie hier eine Nachricht senden, werden Sie {$action} vom Server ausgeschlossen.',
  '',
  '**🇪🇸 / 🇲🇽 :** Este canal está destinado a detectar cuentas de {$platform} que hayan sido pirateadas y a notificárselo a sus titulares. Si envías un mensaje aquí, serás {$action} del servidor.',
].join('\n');

interface PendingSetupSession {
  readonly key: string;
  readonly platform: PlatformId;
  readonly guildId: string;
  readonly invokeChannelId: string;
  readonly targetChannelId: string;
  readonly actorId: string;
  readonly existingConfig: HoneypotConfig | undefined;
  step: 'duration' | 'message' | 'dmMessage';
  chosenDeleteSeconds: number;
  chosenCustomMessage: string | undefined;
  timer: ReturnType<typeof setTimeout>;
}

export interface CreateHoneypotModuleOptions {
  readonly store: HoneypotStore;
  readonly security: SecurityService;
  readonly modLog: ModLogService;
  readonly channelPort: ChannelPort;
  readonly messagingPort: MessagingPort;
  readonly moderationPort: ModerationPort;
  readonly eventBus: EventBus;
  readonly hierarchyCache?: GuildHierarchyCache;
  readonly logger: StructuredLogger;
  readonly setupTimeoutMs?: number;
}

function formatPlatformLabel(platform: PlatformId): string {
  return platform === 'discord' ? 'Discord' : 'Fluxer';
}

function parseChannelMentionOrId(raw: string | undefined): string | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const match = /^(?:<#(\d{17,20})>|(\d{17,20}))$/.exec(raw.trim());
  return match?.[1] ?? match?.[2];
}

function parseDeleteDurationSeconds(raw: string): number | undefined {
  const lower = raw.trim().toLowerCase();
  if (lower === '0' || lower === '0s' || lower === 'none') {
    return 0;
  }
  const ms = parseDurationMs(lower);
  if (ms === undefined) {
    return undefined;
  }
  const seconds = Math.floor(ms / 1000);
  if (seconds < 0 || seconds > MAX_BAN_DELETE_SECONDS) {
    return undefined;
  }
  return seconds;
}

function formatInviteUrl(platform: PlatformId, code: string): string {
  return platform === 'discord' ? `https://discord.gg/${code}` : `https://fluxer.gg/${code}`;
}

export function renderHoneypotMessage(options: {
  readonly platform: PlatformId;
  readonly action: HoneypotAction;
  readonly detectionCount: number;
  readonly customMessage: string | undefined;
}): string {
  const template = options.customMessage ?? DEFAULT_HONEYPOT_TEMPLATE;
  const actionLabel = 'kick';
  return template
    .replaceAll('{$platform}', formatPlatformLabel(options.platform))
    .replaceAll('{$action}', actionLabel)
    .replaceAll('{$detection_count}', String(options.detectionCount));
}

export function renderHoneypotDmMessage(options: {
  readonly communityName: string;
  readonly inviteUrl: string | undefined;
  readonly customDmMessage: string | undefined;
}): string {
  if (options.customDmMessage === undefined) {
    const base = `We suspect your account has been compromised, so you have been removed from ${options.communityName}.`;
    return options.inviteUrl !== undefined
      ? `${base}\nYou can rejoin using: ${options.inviteUrl}`
      : base;
  }
  const hasInvitePlaceholder = options.customDmMessage.includes('{$inviteUrl}');
  const rendered = options.customDmMessage
    .replaceAll('{$action}', 'kick')
    .replaceAll('{$communityName}', options.communityName)
    .replaceAll('{$inviteUrl}', options.inviteUrl ?? '');
  if (!hasInvitePlaceholder && options.inviteUrl !== undefined) {
    return `${rendered}\nYou can rejoin using: ${options.inviteUrl}`;
  }
  return rendered;
}

function clampTopic(text: string): string {
  return text.length <= CHANNEL_TOPIC_MAX_LENGTH ? text : text.slice(0, CHANNEL_TOPIC_MAX_LENGTH);
}

function normalizeText(text: string): string {
  return text.replaceAll('\r\n', '\n').trim();
}

function renderDetectionCountMessage(count: number): string {
  return `## Detection Count: **${count}**`;
}

function sanitizeSnippet(content: string): string {
  return content
    .slice(0, 200)
    .replaceAll('`', "'")
    .replaceAll('@everyone', '@\u200beveryone')
    .replaceAll('@here', '@\u200bhere');
}

export function createHoneypotModule(options: CreateHoneypotModuleOptions): HoneypotModule {
  const {
    store,
    security,
    modLog,
    channelPort,
    messagingPort,
    moderationPort,
    eventBus,
    hierarchyCache,
    logger,
  } = options;
  const setupTimeoutMs = options.setupTimeoutMs ?? DEFAULT_SETUP_TIMEOUT_MS;

  const configCache = new TieredCache<string, HoneypotConfig>({
    l1MaxEntries: 10_000,
    l1TtlMs: 60_000,
  });
  const sessions = new Map<string, PendingSetupSession>();
  const inFlightEnforcements = new Set<string>();
  const recentEnforcements = new Map<string, number>();
  const disposables = new DisposableStore();
  let disposed = false;

  function cacheKey(platform: PlatformId, guildId: string): string {
    return `${platform}:${guildId}`;
  }

  function sessionKey(platform: PlatformId, channelId: string, actorId: string): string {
    return `${platform}:${channelId}:${actorId}`;
  }

  async function loadConfig(
    platform: PlatformId,
    guildId: string,
  ): Promise<HoneypotConfig | undefined> {
    return configCache.getOrLoad(cacheKey(platform, guildId), async () =>
      store.getConfig(platform, guildId),
    );
  }

  function clearSession(key: string): void {
    const session = sessions.get(key);
    if (session !== undefined) {
      clearTimeout(session.timer);
      sessions.delete(key);
    }
  }

  async function syncCounterMessage(config: HoneypotConfig): Promise<void> {
    const content = renderDetectionCountMessage(config.detectionCount);
    if (config.counterMessageId !== undefined) {
      const editRes = await messagingPort.editMessage({
        platform: config.platform,
        channelId: config.channelId,
        messageId: config.counterMessageId,
        content,
      });
      if (editRes.ok) {
        return;
      }
    }

    const sendRes = await messagingPort.sendMessage({
      platform: config.platform,
      channelId: config.channelId,
      content,
    });
    if (sendRes.ok) {
      await store.updateCounterMessageId(config.platform, config.guildId, sendRes.value);
      configCache.invalidate(cacheKey(config.platform, config.guildId));
    }
  }

  async function syncChannelAndWarningMessage(config: HoneypotConfig): Promise<void> {
    const rendered = renderHoneypotMessage({
      platform: config.platform,
      action: config.action,
      detectionCount: config.detectionCount,
      customMessage: config.customMessage,
    });

    const topicRes = await channelPort.updateChannelTopic({
      platform: config.platform,
      channelId: config.channelId,
      topic: clampTopic(rendered),
      reason: 'Honeypot setup/sync',
    });
    if (!topicRes.ok) {
      logger.warn('honeypot.topic_sync_failed', {
        platform: config.platform,
        guildId: config.guildId,
        channelId: config.channelId,
        code: topicRes.error.code,
        message: topicRes.error.message,
      });
    }

    let warningSynced = false;
    if (config.warningMessageId !== undefined) {
      const editRes = await messagingPort.editMessage({
        platform: config.platform,
        channelId: config.channelId,
        messageId: config.warningMessageId,
        content: rendered,
      });
      if (editRes.ok) {
        warningSynced = true;
      }
    }

    if (!warningSynced) {
      const sendRes = await messagingPort.sendMessage({
        platform: config.platform,
        channelId: config.channelId,
        content: rendered,
      });
      if (sendRes.ok) {
        await store.updateWarningMessageId(config.platform, config.guildId, sendRes.value);
        configCache.invalidate(cacheKey(config.platform, config.guildId));
      }
    }

    await syncCounterMessage(config);
  }

  async function resolveRejoinInviteUrl(
    platform: PlatformId,
    guildId: string,
    preferredChannelId: string,
  ): Promise<string | undefined> {
    const vanityCode = hierarchyCache?.getGuildVanityCode(platform, guildId);
    if (vanityCode !== undefined && vanityCode.length > 0) {
      return formatInviteUrl(platform, vanityCode);
    }

    const directRes = await channelPort.createInvite({
      platform,
      channelId: preferredChannelId,
      maxAgeSeconds: 86_400,
      maxUses: 1,
      unique: true,
      reason: 'Honeypot softban rejoin invite',
    });
    if (directRes.ok) {
      return formatInviteUrl(platform, directRes.value);
    }

    const channelsRes = await channelPort.listGuildChannels({platform, guildId});
    if (!channelsRes.ok) {
      return undefined;
    }
    const fallbackChannel = channelsRes.value.find(
      ch => ch.id !== preferredChannelId && (ch.type === 0 || ch.type === 5),
    );
    if (fallbackChannel === undefined) {
      return undefined;
    }
    const fallbackRes = await channelPort.createInvite({
      platform,
      channelId: fallbackChannel.id,
      maxAgeSeconds: 86_400,
      maxUses: 1,
      unique: true,
      reason: 'Honeypot softban rejoin invite',
    });
    return fallbackRes.ok ? formatInviteUrl(platform, fallbackRes.value) : undefined;
  }

  async function finalizeSetup(
    session: PendingSetupSession,
    dmMessage: string | undefined,
  ): Promise<void> {
    clearSession(session.key);
    const existingWarningMessageId =
      session.existingConfig?.channelId === session.targetChannelId
        ? session.existingConfig.warningMessageId
        : undefined;
    const existingCounterMessageId =
      session.existingConfig?.channelId === session.targetChannelId
        ? session.existingConfig.counterMessageId
        : undefined;
    const saved = await store.upsertConfig({
      platform: session.platform,
      guildId: session.guildId,
      channelId: session.targetChannelId,
      action: 'softban',
      deleteMessageSeconds: session.chosenDeleteSeconds,
      customMessage: session.chosenCustomMessage,
      dmMessage,
      warningMessageId: existingWarningMessageId,
      counterMessageId: existingCounterMessageId,
      logChannelId: session.existingConfig?.logChannelId,
      enabled: true,
    });
    configCache.invalidate(cacheKey(session.platform, session.guildId));
    const permRes = await channelPort.setChannelOverwrite({
      platform: saved.platform,
      channelId: saved.channelId,
      overwriteId: saved.guildId,
      targetType: 'role',
      allowBits: HONEYPOT_EVERYONE_ALLOW_BITS,
      denyBits: HONEYPOT_EVERYONE_DENY_BITS,
      reason: 'Honeypot default @everyone permissions',
    });
    if (!permRes.ok) {
      logger.warn('honeypot.overwrite_sync_failed', {
        platform: saved.platform,
        guildId: saved.guildId,
        channelId: saved.channelId,
        code: permRes.error.code,
        message: permRes.error.message,
      });
    }
    await syncChannelAndWarningMessage(saved);

    await messagingPort.sendMessage({
      platform: session.platform,
      channelId: session.invokeChannelId,
      content: [
        `Honeypot configured on <#${saved.channelId}>.`,
        `Action: **softban** (delete **${formatDurationCompact(saved.deleteMessageSeconds * 1000)}**) | Channel Msg: **${saved.customMessage === undefined ? 'default' : 'custom'}** | DM Msg: **${saved.dmMessage === undefined ? 'default' : 'custom'}**`,
      ].join('\n'),
    });
  }

  async function handleSetupReply(session: PendingSetupSession, rawContent: string): Promise<void> {
    const trimmed = rawContent.trim();
    const lower = trimmed.toLowerCase();

    if (lower === 'cancel') {
      clearSession(session.key);
      await messagingPort.sendMessage({
        platform: session.platform,
        channelId: session.invokeChannelId,
        content: 'Honeypot setup cancelled.',
      });
      return;
    }

    if (session.step === 'duration') {
      if (lower === 'keep' && session.existingConfig !== undefined) {
        session.chosenDeleteSeconds = session.existingConfig.deleteMessageSeconds;
      } else if (lower === 'skip' || lower === 'default') {
        session.chosenDeleteSeconds = DEFAULT_BAN_DELETE_SECONDS;
      } else {
        const parsedSeconds = parseDeleteDurationSeconds(trimmed);
        if (parsedSeconds === undefined) {
          await messagingPort.sendMessage({
            platform: session.platform,
            channelId: session.invokeChannelId,
            content:
              'Reply with a message deletion duration between `0s` and `7d` (e.g. `1h`, `1d`, `7d`), `skip` for 7d, or `cancel`.',
          });
          return;
        }
        session.chosenDeleteSeconds = parsedSeconds;
      }

      session.step = 'message';
      const editHint =
        session.existingConfig !== undefined ? ' Reply `keep` to retain the current message,' : '';
      await messagingPort.sendMessage({
        platform: session.platform,
        channelId: session.invokeChannelId,
        content: [
          `Softban message deletion set to **${formatDurationCompact(session.chosenDeleteSeconds * 1000)}**.`,
          `Step 2/3: Send a plain-text channel warning message (max ${CHANNEL_TOPIC_MAX_LENGTH} chars), or reply \`skip\` for the default message.${editHint}`,
        ].join('\n'),
      });
      return;
    }

    if (session.step === 'message') {
      if (lower === 'keep' && session.existingConfig !== undefined) {
        session.chosenCustomMessage = session.existingConfig.customMessage;
      } else if (lower === 'skip' || lower === 'default') {
        session.chosenCustomMessage = undefined;
      } else {
        if (trimmed.length === 0 || trimmed.length > CHANNEL_TOPIC_MAX_LENGTH) {
          await messagingPort.sendMessage({
            platform: session.platform,
            channelId: session.invokeChannelId,
            content: `Custom message must be between 1 and ${CHANNEL_TOPIC_MAX_LENGTH} characters. Try again or reply \`skip\`.`,
          });
          return;
        }
        session.chosenCustomMessage = trimmed;
      }

      session.step = 'dmMessage';
      const editHint =
        session.existingConfig !== undefined
          ? ' Reply `keep` to retain the current DM message,'
          : '';
      await messagingPort.sendMessage({
        platform: session.platform,
        channelId: session.invokeChannelId,
        content: [
          `Channel message set to **${session.chosenCustomMessage === undefined ? 'default' : 'custom'}**.`,
          `Step 3/3: Send a plain-text DM kick message (max ${DM_MESSAGE_MAX_LENGTH} chars; supports \`{$communityName}\`, \`{$inviteUrl}\`, \`{$action}\`), or reply \`skip\` for the default DM.${editHint}`,
        ].join('\n'),
      });
      return;
    }

    if (lower === 'keep' && session.existingConfig !== undefined) {
      await finalizeSetup(session, session.existingConfig.dmMessage);
      return;
    }

    if (lower === 'skip' || lower === 'default') {
      await finalizeSetup(session, undefined);
      return;
    }

    if (trimmed.length === 0 || trimmed.length > DM_MESSAGE_MAX_LENGTH) {
      await messagingPort.sendMessage({
        platform: session.platform,
        channelId: session.invokeChannelId,
        content: `Custom DM message must be between 1 and ${DM_MESSAGE_MAX_LENGTH} characters. Try again or reply \`skip\`.`,
      });
      return;
    }

    await finalizeSetup(session, trimmed);
  }

  async function handleSetupCommand(ctx: CommandInvocationContext): Promise<void> {
    if (ctx.guildId === undefined) {
      await ctx.reply('Honeypot commands can only be used inside a server.');
      return;
    }

    const explicitChannelId =
      ctx.parsed.channelRef ??
      ctx.parsed.targets[0] ??
      parseChannelMentionOrId(ctx.parsed.positionalArgs[0]);
    const existing = await store.getConfig(ctx.platform, ctx.guildId);

    let targetChannelId: string | undefined;
    if (explicitChannelId !== undefined) {
      const channelRes = await channelPort.fetchChannel({
        platform: ctx.platform,
        channelId: explicitChannelId,
      });
      if (!channelRes.ok || channelRes.value.guildId !== ctx.guildId) {
        await ctx.reply('Target channel must exist in this server.');
        return;
      }
      targetChannelId = explicitChannelId;
    } else if (existing !== undefined) {
      const existingChannelRes = await channelPort.fetchChannel({
        platform: ctx.platform,
        channelId: existing.channelId,
      });
      if (existingChannelRes.ok && existingChannelRes.value.guildId === ctx.guildId) {
        targetChannelId = existing.channelId;
      }
    }

    if (targetChannelId === undefined) {
      const createRes = await channelPort.createChannel({
        platform: ctx.platform,
        guildId: ctx.guildId,
        name: 'honeypot',
        type: 0,
        position: 0,
        permissionOverwrites: [
          {
            id: ctx.guildId,
            type: 'role',
            allow: HONEYPOT_EVERYONE_ALLOW_BITS,
            deny: HONEYPOT_EVERYONE_DENY_BITS,
          },
        ],
        reason: 'Honeypot channel setup',
      });
      if (!createRes.ok) {
        await ctx.reply(
          `Failed to create honeypot channel (${createRes.error.code}). Provide an existing channel like \`,honeypot setup #channel\` or grant Manage Channels.`,
        );
        return;
      }
      targetChannelId = createRes.value.id;
    }

    const key = sessionKey(ctx.platform, ctx.channelId, ctx.actorId);
    clearSession(key);
    const timer = setTimeout(() => {
      if (!sessions.has(key)) {
        return;
      }
      sessions.delete(key);
      void messagingPort.sendMessage({
        platform: ctx.platform,
        channelId: ctx.channelId,
        content: 'Honeypot setup timed out after 60s and was cancelled.',
      });
    }, setupTimeoutMs);

    const session: PendingSetupSession = {
      key,
      platform: ctx.platform,
      guildId: ctx.guildId,
      invokeChannelId: ctx.channelId,
      targetChannelId,
      actorId: ctx.actorId,
      existingConfig: existing,
      step: 'duration',
      chosenDeleteSeconds: existing?.deleteMessageSeconds ?? DEFAULT_BAN_DELETE_SECONDS,
      chosenCustomMessage: existing?.customMessage,
      timer,
    };
    sessions.set(key, session);

    if (existing !== undefined) {
      await ctx.reply(
        [
          '**Existing Honeypot Setup Found**',
          `Channel: <#${existing.channelId}> (editing target: <#${targetChannelId}>)`,
          `Action: **softban** (delete **${formatDurationCompact(existing.deleteMessageSeconds * 1000)}**) | Detections: **${existing.detectionCount}**`,
          `Channel Msg: **${existing.customMessage === undefined ? 'default' : 'custom'}** | DM Msg: **${existing.dmMessage === undefined ? 'default' : 'custom'}**`,
          '',
          'Step 1/3 (60s window): Reply with message deletion duration (`0s`–`7d`, e.g. `1h`, `1d`, `7d`), `skip` (7d), `keep`, or `cancel`.',
        ].join('\n'),
      );
      return;
    }

    await ctx.reply(
      [
        `**Honeypot Setup** for <#${targetChannelId}>`,
        'Step 1/3 (60s window): Reply with softban message deletion duration (`0s`–`7d`, e.g. `1h`, `1d`, `7d`), `skip` for 7d, or `cancel`.',
      ].join('\n'),
    );
  }

  async function handleRemoveCommand(ctx: CommandInvocationContext): Promise<void> {
    if (ctx.guildId === undefined) {
      await ctx.reply('Honeypot commands can only be used inside a server.');
      return;
    }
    const existing = await store.getConfig(ctx.platform, ctx.guildId);
    if (existing === undefined) {
      await ctx.reply('No honeypot is configured for this server.');
      return;
    }

    for (const [key, session] of sessions.entries()) {
      if (session.platform === ctx.platform && session.guildId === ctx.guildId) {
        clearSession(key);
      }
    }

    await store.deleteConfig(ctx.platform, ctx.guildId);
    configCache.invalidate(cacheKey(ctx.platform, ctx.guildId));

    const delChannelRes = await channelPort.deleteChannel({
      platform: ctx.platform,
      channelId: existing.channelId,
      reason: 'Honeypot setup removed',
    });

    if (!delChannelRes.ok) {
      if (delChannelRes.error.code !== 'not_found') {
        logger.warn('honeypot.channel_delete_failed', {
          platform: ctx.platform,
          guildId: ctx.guildId,
          channelId: existing.channelId,
          code: delChannelRes.error.code,
          message: delChannelRes.error.message,
        });
      }
      await ctx.reply(
        `Honeypot configuration removed, but <#${existing.channelId}> could not be deleted (${delChannelRes.error.code}).`,
      );
      return;
    }

    if (ctx.channelId !== existing.channelId) {
      await ctx.reply('Honeypot configuration and channel removed.');
    }
  }

  async function handleStatusCommand(ctx: CommandInvocationContext): Promise<void> {
    if (ctx.guildId === undefined) {
      await ctx.reply('Honeypot commands can only be used inside a server.');
      return;
    }
    const config = await loadConfig(ctx.platform, ctx.guildId);
    if (config === undefined) {
      await ctx.reply('No honeypot is configured for this server. Run `,honeypot setup`.');
      return;
    }
    await ctx.reply(
      [
        '**Honeypot Status**',
        `Enabled: **${config.enabled ? 'yes' : 'no'}**`,
        `Channel: <#${config.channelId}>`,
        `Action: **softban** (delete **${formatDurationCompact(config.deleteMessageSeconds * 1000)}**)`,
        `Detections: **${config.detectionCount}**`,
        `Log Channel: ${config.logChannelId !== undefined ? `<#${config.logChannelId}>` : 'guild default modlog'}`,
        `Channel Message: **${config.customMessage === undefined ? 'default' : 'custom'}**`,
        `DM Message: **${config.dmMessage === undefined ? 'default' : 'custom'}**`,
      ].join('\n'),
    );
  }

  async function handleLogCommand(ctx: CommandInvocationContext): Promise<void> {
    if (ctx.guildId === undefined) {
      await ctx.reply('Honeypot commands can only be used inside a server.');
      return;
    }
    const arg = ctx.parsed.positionalArgs[0]?.trim().toLowerCase();
    const logChannelId =
      arg === 'off'
        ? undefined
        : (ctx.parsed.channelRef ?? ctx.parsed.targets[0] ?? parseChannelMentionOrId(arg));
    if (arg !== 'off' && logChannelId === undefined) {
      await ctx.reply('Usage: `,honeypot log <#channel|off>`');
      return;
    }
    if (logChannelId !== undefined) {
      const channelRes = await channelPort.fetchChannel({
        platform: ctx.platform,
        channelId: logChannelId,
      });
      if (!channelRes.ok || channelRes.value.guildId !== ctx.guildId) {
        await ctx.reply('Log channel must exist in this server.');
        return;
      }
    }
    const updated = await store.setLogChannelId(ctx.platform, ctx.guildId, logChannelId);
    configCache.invalidate(cacheKey(ctx.platform, ctx.guildId));
    if (!updated) {
      await ctx.reply('No honeypot is configured for this server. Run `,honeypot setup` first.');
      return;
    }
    await ctx.reply(
      logChannelId === undefined
        ? 'Honeypot log channel reset to guild default modlog.'
        : `Honeypot log channel set to <#${logChannelId}>.`,
    );
  }

  disposables.add(
    eventBus.subscribe('MESSAGE_CREATE', async event => {
      if (disposed || event.data.author.bot === true || event.data.guild_id === undefined) {
        return;
      }

      const activeSession = sessions.get(
        sessionKey(event.platform, event.data.channel_id, event.data.author.id),
      );
      if (activeSession !== undefined) {
        await handleSetupReply(activeSession, event.data.content);
        return;
      }

      const config = await loadConfig(event.platform, event.data.guild_id);
      if (config === undefined || !config.enabled || event.data.channel_id !== config.channelId) {
        return;
      }

      const guildOwnerId = await hierarchyCache?.resolveGuildOwnerId(
        event.platform,
        event.data.guild_id,
      );
      const actorLevel = await security.resolveActorLevel({
        platform: event.platform,
        guildId: event.data.guild_id,
        userId: event.data.author.id,
        guildOwnerId,
        roleIds: event.data.member?.roles ?? [],
      });

      // exclude bound staff (L1), bound admin (L2), acting owner (L3), true owner (L4), and platform developer (L5)
      if (actorLevel >= AuthorityLevel.BoundStaff) {
        return;
      }

      if (event.data.id !== undefined) {
        await messagingPort.deleteMessage({
          platform: event.platform,
          channelId: event.data.channel_id,
          messageId: event.data.id,
          reason: 'Honeypot trigger message cleanup',
        });
      }

      const enforcementKey = `${event.platform}:${event.data.guild_id}:${event.data.author.id}`;
      const now = Date.now();
      const lastEnforcedAt = recentEnforcements.get(enforcementKey);
      if (
        inFlightEnforcements.has(enforcementKey) ||
        (lastEnforcedAt !== undefined && now - lastEnforcedAt < ENFORCEMENT_DEDUPE_TTL_MS)
      ) {
        return;
      }
      inFlightEnforcements.add(enforcementKey);

      try {
        const communityName =
          hierarchyCache?.getGuildName(event.platform, event.data.guild_id) ?? 'this server';
        const inviteUrl = await resolveRejoinInviteUrl(
          event.platform,
          event.data.guild_id,
          config.channelId,
        );
        const dmContent = renderHoneypotDmMessage({
          communityName,
          inviteUrl,
          customDmMessage: config.dmMessage,
        });
        const dmRes = await messagingPort.sendDirectMessage({
          platform: event.platform,
          userId: event.data.author.id,
          content: dmContent,
        });
        if (!dmRes.ok) {
          logger.debug('honeypot.dm_failed', {
            platform: event.platform,
            guildId: event.data.guild_id,
            userId: event.data.author.id,
            code: dmRes.error.code,
          });
        }

        const reason = `Honeypot triggered in <#${config.channelId}> (softban, delete ${formatDurationCompact(config.deleteMessageSeconds * 1000)})`;
        const banRes = await moderationPort.banMember({
          platform: event.platform,
          guildId: event.data.guild_id,
          userId: event.data.author.id,
          deleteMessageSeconds: config.deleteMessageSeconds,
          reason,
        });

        if (!banRes.ok) {
          logger.warn('honeypot.moderation_failed', {
            platform: event.platform,
            guildId: event.data.guild_id,
            userId: event.data.author.id,
            action: 'softban',
            code: banRes.error.code,
            message: banRes.error.message,
          });
          await modLog.logAction({
            platform: event.platform,
            guildId: event.data.guild_id,
            channelId: config.logChannelId,
            module: 'honeypot',
            action: 'softban_failed',
            targetUserId: event.data.author.id,
            reason: `${reason} (${banRes.error.code}: ${banRes.error.message})`,
          });
          return;
        }

        const unbanRes = await moderationPort.unbanMember({
          platform: event.platform,
          guildId: event.data.guild_id,
          userId: event.data.author.id,
          reason: 'Honeypot softban immediate unban',
        });
        if (!unbanRes.ok) {
          logger.warn('honeypot.softban_unban_failed', {
            platform: event.platform,
            guildId: event.data.guild_id,
            userId: event.data.author.id,
            code: unbanRes.error.code,
            message: unbanRes.error.message,
          });
        }

        recentEnforcements.set(enforcementKey, Date.now());
        const nextCount = await store.incrementDetectionCount(event.platform, event.data.guild_id);
        configCache.invalidate(cacheKey(event.platform, event.data.guild_id));
        await syncCounterMessage({...config, detectionCount: nextCount});

        const snippet = sanitizeSnippet(event.data.content);
        await modLog.logAction({
          platform: event.platform,
          guildId: event.data.guild_id,
          channelId: config.logChannelId,
          module: 'honeypot',
          action: unbanRes.ok ? 'softban' : 'softban_unban_failed',
          targetUserId: event.data.author.id,
          reason,
          details: snippet.length > 0 ? `Message: \`${snippet}\`` : undefined,
        });
      } finally {
        inFlightEnforcements.delete(enforcementKey);
      }
    }),
  );

  disposables.add(
    eventBus.subscribe('CHANNEL_UPDATE', async event => {
      if (disposed || event.data.guild_id === undefined) {
        return;
      }
      const config = await loadConfig(event.platform, event.data.guild_id);
      if (config === undefined || !config.enabled || event.data.id !== config.channelId) {
        return;
      }
      const newTopic = event.data.topic ?? undefined;
      if (newTopic === undefined || newTopic.trim().length === 0) {
        return;
      }

      const currentRendered = renderHoneypotMessage({
        platform: config.platform,
        action: config.action,
        detectionCount: config.detectionCount,
        customMessage: config.customMessage,
      });
      if (normalizeText(newTopic) === normalizeText(clampTopic(currentRendered))) {
        return;
      }

      await store.updateCustomMessage(event.platform, event.data.guild_id, newTopic);
      configCache.invalidate(cacheKey(event.platform, event.data.guild_id));

      const syncedText = renderHoneypotMessage({
        platform: config.platform,
        action: config.action,
        detectionCount: config.detectionCount,
        customMessage: newTopic,
      });

      if (config.warningMessageId !== undefined) {
        const editRes = await messagingPort.editMessage({
          platform: config.platform,
          channelId: config.channelId,
          messageId: config.warningMessageId,
          content: syncedText,
        });
        if (editRes.ok) {
          return;
        }
      }

      const sendRes = await messagingPort.sendMessage({
        platform: config.platform,
        channelId: config.channelId,
        content: syncedText,
      });
      if (sendRes.ok) {
        await store.updateWarningMessageId(event.platform, event.data.guild_id, sendRes.value);
        configCache.invalidate(cacheKey(event.platform, event.data.guild_id));
      }
    }),
  );

  return {
    registerCommands: (registry: CommandRegistry): void => {
      registry.register({
        name: 'honeypot',
        aliases: ['honeypot setup', 'honeypot s'],
        moduleId: 'honeypot',
        permissionNode: 'server.honeypot.manage',
        description: 'Interactive 60s setup for the server honeypot channel',
        mutatesState: true,
        execute: handleSetupCommand,
      });

      registry.register({
        name: 'honeypot remove',
        aliases: ['honeypot rm', 'honeypot del'],
        moduleId: 'honeypot',
        permissionNode: 'server.honeypot.manage',
        description: 'Remove the server honeypot configuration',
        mutatesState: true,
        execute: handleRemoveCommand,
      });

      registry.register({
        name: 'honeypot status',
        aliases: ['honeypot info'],
        moduleId: 'honeypot',
        permissionNode: 'server.honeypot.manage',
        description: 'View current honeypot configuration and detection count',
        mutatesState: false,
        execute: handleStatusCommand,
      });

      registry.register({
        name: 'honeypot log',
        moduleId: 'honeypot',
        permissionNode: 'server.honeypot.manage',
        description: 'Set or clear the honeypot alert log channel',
        mutatesState: true,
        execute: handleLogCommand,
      });
    },

    flushAllCaches: (): void => {
      configCache.clear();
    },

    dispose: (): void => {
      if (disposed) {
        return;
      }
      disposed = true;
      for (const key of [...sessions.keys()]) {
        clearSession(key);
      }
      disposables.dispose();
    },
  };
}
