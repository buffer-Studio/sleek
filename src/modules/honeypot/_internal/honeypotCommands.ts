import type {PlatformId} from '../../../base/common/platformId';
import type {
  CommandInvocationContext,
  CommandRegistry,
} from '../../../core/commands/commandRegistry';
import {formatDurationCompact} from '../../../core/parser/durationParser';
import type {HoneypotConfig} from '../honeypot.contract';
import {type HoneypotRuntimeDeps, syncChannelAndWarningMessage} from './honeypotHandlers';
import {
  CHANNEL_TOPIC_MAX_LENGTH,
  DEFAULT_BAN_DELETE_SECONDS,
  DM_MESSAGE_MAX_LENGTH,
  HONEYPOT_EVERYONE_ALLOW_BITS,
  HONEYPOT_EVERYONE_DENY_BITS,
  parseChannelMentionOrId,
  parseDeleteDurationSeconds,
  parseInviteUrlOrCode,
} from './honeypotRenderers';

export interface PendingSetupSession {
  readonly key: string;
  readonly platform: PlatformId;
  readonly guildId: string;
  readonly invokeChannelId: string;
  readonly targetChannelId: string;
  readonly actorId: string;
  readonly existingConfig: HoneypotConfig | undefined;
  step: 'duration' | 'message' | 'dmMessage' | 'invite';
  chosenDeleteSeconds: number;
  chosenCustomMessage: string | undefined;
  chosenDmMessage: string | undefined;
  timer: ReturnType<typeof setTimeout>;
}

export interface HoneypotCommandDeps extends HoneypotRuntimeDeps {
  readonly sessions: Map<string, PendingSetupSession>;
  readonly setupTimeoutMs: number;
  readonly sessionKey: (platform: PlatformId, channelId: string, actorId: string) => string;
  readonly clearSession: (key: string) => void;
}

async function finalizeSetup(
  deps: HoneypotCommandDeps,
  session: PendingSetupSession,
  dmMessage: string | undefined,
  inviteUrl: string | undefined,
): Promise<void> {
  deps.clearSession(session.key);
  const existingWarningMessageId =
    session.existingConfig?.channelId === session.targetChannelId
      ? session.existingConfig.warningMessageId
      : undefined;
  const existingCounterMessageId =
    session.existingConfig?.channelId === session.targetChannelId
      ? session.existingConfig.counterMessageId
      : undefined;
  const saved = await deps.store.upsertConfig({
    platform: session.platform,
    guildId: session.guildId,
    channelId: session.targetChannelId,
    action: 'softban',
    deleteMessageSeconds: session.chosenDeleteSeconds,
    customMessage: session.chosenCustomMessage,
    dmMessage,
    inviteUrl,
    warningMessageId: existingWarningMessageId,
    counterMessageId: existingCounterMessageId,
    logChannelId: session.existingConfig?.logChannelId,
    enabled: true,
  });
  deps.configCache.invalidate(deps.cacheKey(session.platform, session.guildId));
  const permRes = await deps.channelPort.setChannelOverwrite({
    platform: saved.platform,
    channelId: saved.channelId,
    overwriteId: saved.guildId,
    targetType: 'role',
    allowBits: HONEYPOT_EVERYONE_ALLOW_BITS,
    denyBits: HONEYPOT_EVERYONE_DENY_BITS,
    reason: 'Honeypot default @everyone permissions',
  });
  if (!permRes.ok) {
    deps.logger.warn('honeypot.overwrite_sync_failed', {
      platform: saved.platform,
      guildId: saved.guildId,
      channelId: saved.channelId,
      code: permRes.error.code,
      message: permRes.error.message,
    });
  }
  await syncChannelAndWarningMessage(deps, saved);

  await deps.messagingPort.sendMessage({
    platform: session.platform,
    channelId: session.invokeChannelId,
    content: [
      `Honeypot configured on <#${saved.channelId}>.`,
      `Action: **softban** (delete **${formatDurationCompact(saved.deleteMessageSeconds * 1000)}**) | Channel Msg: **${saved.customMessage === undefined ? 'default' : 'custom'}** | DM Msg: **${saved.dmMessage === undefined ? 'default' : 'custom'}**`,
    ].join('\n'),
  });
}

export async function handleSetupReply(
  deps: HoneypotCommandDeps,
  session: PendingSetupSession,
  rawContent: string,
): Promise<void> {
  const trimmed = rawContent.trim();
  const lower = trimmed.toLowerCase();

  if (lower === 'cancel') {
    deps.clearSession(session.key);
    await deps.messagingPort.sendMessage({
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
        await deps.messagingPort.sendMessage({
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
    await deps.messagingPort.sendMessage({
      platform: session.platform,
      channelId: session.invokeChannelId,
      content: [
        `Softban message deletion set to **${formatDurationCompact(session.chosenDeleteSeconds * 1000)}**.`,
        `Step 2/4: Send a plain-text channel warning message (max ${CHANNEL_TOPIC_MAX_LENGTH} chars), or reply \`skip\` for the default message.${editHint}`,
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
        await deps.messagingPort.sendMessage({
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
      session.existingConfig !== undefined ? ' Reply `keep` to retain the current DM message,' : '';
    await deps.messagingPort.sendMessage({
      platform: session.platform,
      channelId: session.invokeChannelId,
      content: [
        `Channel message set to **${session.chosenCustomMessage === undefined ? 'default' : 'custom'}**.`,
        `Step 3/4: Send a plain-text DM kick message (max ${DM_MESSAGE_MAX_LENGTH} chars; supports \`{$communityName}\`, \`{$inviteUrl}\`, \`{$action}\`), or reply \`skip\` for the default DM.${editHint}`,
      ].join('\n'),
    });
    return;
  }

  if (session.step === 'dmMessage') {
    if (lower === 'keep' && session.existingConfig !== undefined) {
      session.chosenDmMessage = session.existingConfig.dmMessage;
    } else if (lower === 'skip' || lower === 'default') {
      session.chosenDmMessage = undefined;
    } else if (trimmed.length === 0 || trimmed.length > DM_MESSAGE_MAX_LENGTH) {
      await deps.messagingPort.sendMessage({
        platform: session.platform,
        channelId: session.invokeChannelId,
        content: `Custom DM message must be between 1 and ${DM_MESSAGE_MAX_LENGTH} characters. Try again or reply \`skip\`.`,
      });
      return;
    } else {
      session.chosenDmMessage = trimmed;
    }

    session.step = 'invite';
    const editHint =
      session.existingConfig?.inviteUrl !== undefined
        ? ' Reply `keep` to retain the current invite URL.'
        : '';
    await deps.messagingPort.sendMessage({
      platform: session.platform,
      channelId: session.invokeChannelId,
      content: [
        `DM message set to **${session.chosenDmMessage === undefined ? 'default' : 'custom'}**.`,
        `Step 4/4: Send the server invite URL or code to include in kick DMs (e.g. \`https://discord.gg/yourcode\`, \`discord.gg/yourcode\`, or \`yourcode\`). This step cannot be skipped.${editHint}`,
      ].join('\n'),
    });
    return;
  }

  if (lower === 'keep' && session.existingConfig?.inviteUrl !== undefined) {
    await finalizeSetup(deps, session, session.chosenDmMessage, session.existingConfig.inviteUrl);
    return;
  }

  const parsedInvite = parseInviteUrlOrCode(trimmed);
  if (parsedInvite === undefined) {
    await deps.messagingPort.sendMessage({
      platform: session.platform,
      channelId: session.invokeChannelId,
      content:
        'Invalid invite URL or code. Send a valid Discord invite URL or code (e.g. `https://discord.gg/yourcode`, `discord.gg/yourcode`, or `yourcode`). This step cannot be skipped.',
    });
    return;
  }

  await finalizeSetup(deps, session, session.chosenDmMessage, parsedInvite);
}

async function handleSetupCommand(
  deps: HoneypotCommandDeps,
  ctx: CommandInvocationContext,
): Promise<void> {
  if (ctx.guildId === undefined) {
    await ctx.reply('Honeypot commands can only be used inside a server.');
    return;
  }

  const explicitChannelId =
    ctx.parsed.channelRef ??
    ctx.parsed.targets[0] ??
    parseChannelMentionOrId(ctx.parsed.positionalArgs[0]);
  const existing = await deps.store.getConfig(ctx.platform, ctx.guildId);

  let targetChannelId: string | undefined;
  if (explicitChannelId !== undefined) {
    const channelRes = await deps.channelPort.fetchChannel({
      platform: ctx.platform,
      channelId: explicitChannelId,
    });
    if (!channelRes.ok || channelRes.value.guildId !== ctx.guildId) {
      await ctx.reply('Target channel must exist in this server.');
      return;
    }
    targetChannelId = explicitChannelId;
  } else if (existing !== undefined) {
    const existingChannelRes = await deps.channelPort.fetchChannel({
      platform: ctx.platform,
      channelId: existing.channelId,
    });
    if (existingChannelRes.ok && existingChannelRes.value.guildId === ctx.guildId) {
      targetChannelId = existing.channelId;
    }
  }

  if (targetChannelId === undefined) {
    const createRes = await deps.channelPort.createChannel({
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

  const key = deps.sessionKey(ctx.platform, ctx.channelId, ctx.actorId);
  deps.clearSession(key);
  const timer = setTimeout(() => {
    if (!deps.sessions.has(key)) {
      return;
    }
    deps.sessions.delete(key);
    void deps.messagingPort.sendMessage({
      platform: ctx.platform,
      channelId: ctx.channelId,
      content: 'Honeypot setup timed out after 60s and was cancelled.',
    });
  }, deps.setupTimeoutMs);

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
    chosenDmMessage: existing?.dmMessage,
    timer,
  };
  deps.sessions.set(key, session);

  if (existing !== undefined) {
    await ctx.reply(
      [
        '**Existing Honeypot Setup Found**',
        `Channel: <#${existing.channelId}> (editing target: <#${targetChannelId}>)`,
        `Action: **softban** (delete **${formatDurationCompact(existing.deleteMessageSeconds * 1000)}**) | Detections: **${existing.detectionCount}**`,
        `Channel Msg: **${existing.customMessage === undefined ? 'default' : 'custom'}** | DM Msg: **${existing.dmMessage === undefined ? 'default' : 'custom'}**`,
        '',
        'Step 1/4 (60s window): Reply with message deletion duration (`0s`–`7d`, e.g. `1h`, `1d`, `7d`), `skip` (7d), `keep`, or `cancel`.',
      ].join('\n'),
    );
    return;
  }

  await ctx.reply(
    [
      `**Honeypot Setup** for <#${targetChannelId}>`,
      'Step 1/4 (60s window): Reply with softban message deletion duration (`0s`–`7d`, e.g. `1h`, `1d`, `7d`), `skip` for 7d, or `cancel`.',
    ].join('\n'),
  );
}

async function handleRemoveCommand(
  deps: HoneypotCommandDeps,
  ctx: CommandInvocationContext,
): Promise<void> {
  if (ctx.guildId === undefined) {
    await ctx.reply('Honeypot commands can only be used inside a server.');
    return;
  }
  const existing = await deps.store.getConfig(ctx.platform, ctx.guildId);
  if (existing === undefined) {
    await ctx.reply('No honeypot is configured for this server.');
    return;
  }

  for (const [key, session] of deps.sessions.entries()) {
    if (session.guildId === ctx.guildId) {
      deps.clearSession(key);
    }
  }

  await deps.store.deleteConfig(ctx.platform, ctx.guildId);
  deps.configCache.invalidate(deps.cacheKey(ctx.platform, ctx.guildId));

  const delChannelRes = await deps.channelPort.deleteChannel({
    platform: ctx.platform,
    channelId: existing.channelId,
    reason: 'Honeypot setup removed',
  });

  if (!delChannelRes.ok) {
    if (delChannelRes.error.code !== 'not_found') {
      deps.logger.warn('honeypot.channel_delete_failed', {
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

async function handleStatusCommand(
  deps: HoneypotCommandDeps,
  ctx: CommandInvocationContext,
): Promise<void> {
  if (ctx.guildId === undefined) {
    await ctx.reply('Honeypot commands can only be used inside a server.');
    return;
  }
  const config = await deps.loadConfig(ctx.platform, ctx.guildId);
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

async function handleLogCommand(
  deps: HoneypotCommandDeps,
  ctx: CommandInvocationContext,
): Promise<void> {
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
    const channelRes = await deps.channelPort.fetchChannel({
      platform: ctx.platform,
      channelId: logChannelId,
    });
    if (!channelRes.ok || channelRes.value.guildId !== ctx.guildId) {
      await ctx.reply('Log channel must exist in this server.');
      return;
    }
  }
  let webhook: {readonly id: string; readonly token: string} | undefined;
  if (logChannelId !== undefined && deps.messagingPort.createWebhook !== undefined) {
    const whRes = await deps.messagingPort.createWebhook({
      platform: ctx.platform,
      channelId: logChannelId,
      name: 'Honeypot Logs',
    });
    if (whRes.ok && whRes.value.id.length > 0 && whRes.value.token.length > 0) {
      webhook = whRes.value;
    }
  }
  const updated = await deps.store.setLogChannelId(
    ctx.platform,
    ctx.guildId,
    logChannelId,
    webhook,
  );
  deps.configCache.invalidate(deps.cacheKey(ctx.platform, ctx.guildId));
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

export function registerHoneypotCommands(
  registry: CommandRegistry,
  deps: HoneypotCommandDeps,
): void {
  registry.register({
    name: 'honeypot',
    aliases: ['honeypot setup', 'honeypot s'],
    moduleId: 'honeypot',
    permissionNode: 'server.honeypot.manage',
    description: 'Interactive 60s setup for the server honeypot channel',
    mutatesState: true,
    execute: async ctx => handleSetupCommand(deps, ctx),
  });

  registry.register({
    name: 'honeypot remove',
    aliases: ['honeypot rm', 'honeypot del'],
    moduleId: 'honeypot',
    permissionNode: 'server.honeypot.manage',
    description: 'Remove the server honeypot configuration',
    mutatesState: true,
    execute: async ctx => handleRemoveCommand(deps, ctx),
  });

  registry.register({
    name: 'honeypot status',
    aliases: ['honeypot info'],
    moduleId: 'honeypot',
    permissionNode: 'server.honeypot.manage',
    description: 'View current honeypot configuration and detection count',
    mutatesState: false,
    execute: async ctx => handleStatusCommand(deps, ctx),
  });

  registry.register({
    name: 'honeypot log',
    moduleId: 'honeypot',
    permissionNode: 'server.honeypot.manage',
    description: 'Set or clear the honeypot alert log channel',
    mutatesState: true,
    execute: async ctx => handleLogCommand(deps, ctx),
  });
}
