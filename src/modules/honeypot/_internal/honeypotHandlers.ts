import type {PlatformId} from '../../../base/common/platformId';
import {AuthorityLevel} from '../../../core/auth/authorityLevel';
import type {AsyncEventHandler} from '../../../core/events/eventBus';
import type {GuildHierarchyCache} from '../../../core/hierarchy/guildHierarchyCache';
import {formatDurationCompact} from '../../../core/parser/durationParser';
import type {ChannelPort} from '../../../core/ports/channel.port';
import type {MessagingPort} from '../../../core/ports/messaging.port';
import type {ModerationPort} from '../../../core/ports/moderation.port';
import type {TieredCache} from '../../../platform/cache/tieredCache';
import type {StructuredLogger} from '../../../platform/logger/structuredLogger';
import type {ModLogService} from '../../logging/modLog.contract';
import type {SecurityService} from '../../security/security.contract';
import type {HoneypotConfig, HoneypotStore} from '../honeypot.contract';
import {
  clampTopic,
  formatInviteUrl,
  normalizeText,
  renderHoneypotDmComponents,
  renderHoneypotDmMessage,
  renderHoneypotMessage,
  renderHoneypotWarningComponents,
  sanitizeSnippet,
} from './honeypotRenderers';

const ENFORCEMENT_DEDUPE_TTL_MS = 10_000;

export interface HoneypotRuntimeDeps {
  readonly store: HoneypotStore;
  readonly security: SecurityService;
  readonly modLog: ModLogService;
  readonly channelPort: ChannelPort;
  readonly messagingPort: MessagingPort;
  readonly moderationPort: ModerationPort;
  readonly hierarchyCache?: GuildHierarchyCache;
  readonly logger: StructuredLogger;
  readonly configCache: TieredCache<string, HoneypotConfig>;
  readonly inFlightEnforcements: Set<string>;
  readonly recentEnforcements: Map<string, number>;
  readonly cacheKey: (platform: PlatformId, guildId: string) => string;
  readonly loadConfig: (
    platform: PlatformId,
    guildId: string,
  ) => Promise<HoneypotConfig | undefined>;
}

export async function syncChannelAndWarningMessage(
  deps: HoneypotRuntimeDeps,
  config: HoneypotConfig,
): Promise<void> {
  const rendered = renderHoneypotMessage({
    platform: config.platform,
    action: config.action,
    detectionCount: config.detectionCount,
    customMessage: config.customMessage,
  });

  const topicRes = await deps.channelPort.updateChannelTopic({
    platform: config.platform,
    channelId: config.channelId,
    topic: clampTopic(rendered),
    reason: 'Honeypot setup/sync',
  });
  if (!topicRes.ok) {
    deps.logger.warn('honeypot.topic_sync_failed', {
      platform: config.platform,
      guildId: config.guildId,
      channelId: config.channelId,
      code: topicRes.error.code,
      message: topicRes.error.message,
    });
  }

  const globalCount = await deps.store.getGlobalDetectionCount();
  const components = renderHoneypotWarningComponents(config.detectionCount, globalCount);

  let warningSynced = false;
  if (config.warningMessageId !== undefined) {
    const editRes = await deps.messagingPort.editMessage({
      platform: config.platform,
      channelId: config.channelId,
      messageId: config.warningMessageId,
      content: rendered,
      components,
    });
    if (editRes.ok) {
      warningSynced = true;
    }
  }

  if (!warningSynced) {
    const sendRes = await deps.messagingPort.sendMessage({
      platform: config.platform,
      channelId: config.channelId,
      content: rendered,
      components,
    });
    if (sendRes.ok) {
      await deps.store.updateWarningMessageId(config.platform, config.guildId, sendRes.value);
      deps.configCache.invalidate(deps.cacheKey(config.platform, config.guildId));
    }
  }
}

function resolveRejoinInviteUrl(
  deps: HoneypotRuntimeDeps,
  platform: PlatformId,
  guildId: string,
  configuredInviteUrl: string | undefined,
): string | undefined {
  if (configuredInviteUrl !== undefined && configuredInviteUrl.length > 0) {
    return configuredInviteUrl;
  }
  const vanityCode = deps.hierarchyCache?.getGuildVanityCode(platform, guildId);
  if (vanityCode !== undefined && vanityCode.length > 0) {
    return formatInviteUrl(platform, vanityCode);
  }
  return undefined;
}

export async function handleHoneypotTrapMessage(
  deps: HoneypotRuntimeDeps,
  event: Parameters<AsyncEventHandler<'MESSAGE_CREATE'>>[0],
): Promise<void> {
  if (event.data.guild_id === undefined) {
    return;
  }
  const config = await deps.loadConfig(event.platform, event.data.guild_id);
  if (config === undefined || !config.enabled || event.data.channel_id !== config.channelId) {
    return;
  }

  const guildOwnerId = await deps.hierarchyCache?.resolveGuildOwnerId(
    event.platform,
    event.data.guild_id,
  );
  const actorLevel = await deps.security.resolveActorLevel({
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
    await deps.messagingPort.deleteMessage({
      platform: event.platform,
      channelId: event.data.channel_id,
      messageId: event.data.id,
      reason: 'Honeypot trigger message cleanup',
    });
  }

  const enforcementKey = `${event.platform}:${event.data.guild_id}:${event.data.author.id}`;
  const now = Date.now();
  const lastEnforcedAt = deps.recentEnforcements.get(enforcementKey);
  if (
    deps.inFlightEnforcements.has(enforcementKey) ||
    (lastEnforcedAt !== undefined && now - lastEnforcedAt < ENFORCEMENT_DEDUPE_TTL_MS)
  ) {
    return;
  }
  deps.inFlightEnforcements.add(enforcementKey);

  try {
    const communityName =
      deps.hierarchyCache?.getGuildName(event.platform, event.data.guild_id) ?? 'this server';
    const inviteUrl = resolveRejoinInviteUrl(
      deps,
      event.platform,
      event.data.guild_id,
      config.inviteUrl,
    );
    const durationLabel = formatDurationCompact(config.deleteMessageSeconds * 1000);
    const channelRes = await deps.channelPort.fetchChannel({
      platform: event.platform,
      channelId: config.channelId,
    });
    const channelName = channelRes.ok
      ? (channelRes.value.name ?? config.channelId)
      : config.channelId;
    const supportServerUrl = process.env.SUPPORT_SERVER_URL ?? 'https://discord.gg/26MMXRHgZB';
    const dmRes =
      config.dmMessage === undefined
        ? await deps.messagingPort.sendDirectMessage({
            platform: event.platform,
            userId: event.data.author.id,
            content: '',
            flags: 32_768,
            components: renderHoneypotDmComponents({
              guildName: communityName,
              guildId: event.data.guild_id,
              channelName,
              channelLink: `https://discord.com/channels/${event.data.guild_id}/${config.channelId}`,
              durationLabel,
              inviteUrl: inviteUrl ?? supportServerUrl,
              supportServerUrl,
            }),
          })
        : await deps.messagingPort.sendDirectMessage({
            platform: event.platform,
            userId: event.data.author.id,
            content: renderHoneypotDmMessage({
              communityName,
              inviteUrl,
              customDmMessage: config.dmMessage,
            }),
          });
    const dmStatus = dmRes.ok ? 'Sent' : 'Failed (User DMs closed)';
    if (!dmRes.ok) {
      deps.logger.debug('honeypot.dm_failed', {
        platform: event.platform,
        guildId: event.data.guild_id,
        userId: event.data.author.id,
        code: dmRes.error.code,
      });
    }

    const reason = `[Honeypot] Message in #${channelName} | Softban (Purge: ${durationLabel})`;
    const banRes = await deps.moderationPort.banMember({
      platform: event.platform,
      guildId: event.data.guild_id,
      userId: event.data.author.id,
      deleteMessageSeconds: config.deleteMessageSeconds,
      reason,
    });

    if (!banRes.ok) {
      deps.logger.warn('honeypot.moderation_failed', {
        platform: event.platform,
        guildId: event.data.guild_id,
        userId: event.data.author.id,
        action: 'softban',
        code: banRes.error.code,
        message: banRes.error.message,
      });
      await deps.modLog.logAction({
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

    const unbanRes = await deps.moderationPort.unbanMember({
      platform: event.platform,
      guildId: event.data.guild_id,
      userId: event.data.author.id,
      reason: 'Honeypot softban immediate unban',
    });
    if (!unbanRes.ok) {
      deps.logger.warn('honeypot.softban_unban_failed', {
        platform: event.platform,
        guildId: event.data.guild_id,
        userId: event.data.author.id,
        code: unbanRes.error.code,
        message: unbanRes.error.message,
      });
    }

    deps.recentEnforcements.set(enforcementKey, Date.now());
    const nextCount = await deps.store.incrementDetectionCount(event.platform, event.data.guild_id);
    deps.configCache.invalidate(deps.cacheKey(event.platform, event.data.guild_id));
    await syncChannelAndWarningMessage(deps, {...config, detectionCount: nextCount});

    const snippet = sanitizeSnippet(event.data.content);
    const actionLabel = unbanRes.ok ? 'softban' : 'softban_unban_failed';
    const accountCreatedSec = Math.floor(
      Number((BigInt(event.data.author.id) >> 22n) + 1_420_070_400_000n) / 1000,
    );
    const memberObj: Record<string, unknown> | undefined = event.data.member;
    const memberJoinedAt =
      memberObj !== undefined && typeof memberObj.joined_at === 'string'
        ? memberObj.joined_at
        : undefined;
    const joinedAtSec =
      memberJoinedAt !== undefined ? Math.floor(Date.parse(memberJoinedAt) / 1000) : undefined;
    const joinAgeLabel =
      joinedAtSec !== undefined && !Number.isNaN(joinedAtSec) ? `<t:${joinedAtSec}:R>` : 'Unknown';
    if (
      config.logWebhookId !== undefined &&
      config.logWebhookToken !== undefined &&
      deps.messagingPort.executeWebhook !== undefined
    ) {
      const whRes = await deps.messagingPort.executeWebhook({
        platform: event.platform,
        webhookId: config.logWebhookId,
        webhookToken: config.logWebhookToken,
        content: [
          `**Honeypot ${actionLabel}**`,
          `User: <@${event.data.author.id}> (\`${event.data.author.id}\`)`,
          `Message ID: \`${event.data.id}\``,
          `Account Age: <t:${accountCreatedSec}:R> | Join Age: ${joinAgeLabel}`,
          `DM Status: ${dmStatus}`,
          ...(snippet.length > 0 ? [`Trigger Content:\n\`\`\`\n${snippet}\n\`\`\``] : []),
        ].join('\n'),
      });
      if (whRes.ok) {
        return;
      }
    }
    await deps.modLog.logAction({
      platform: event.platform,
      guildId: event.data.guild_id,
      channelId: config.logChannelId,
      module: 'honeypot',
      action: actionLabel,
      targetUserId: event.data.author.id,
      reason,
      details: snippet.length > 0 ? `Message: \`${snippet}\`` : undefined,
    });
  } finally {
    deps.inFlightEnforcements.delete(enforcementKey);
  }
}

export async function handleHoneypotChannelUpdate(
  deps: HoneypotRuntimeDeps,
  event: Parameters<AsyncEventHandler<'CHANNEL_UPDATE'>>[0],
): Promise<void> {
  if (event.data.guild_id === undefined) {
    return;
  }
  const config = await deps.loadConfig(event.platform, event.data.guild_id);
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

  await deps.store.updateCustomMessage(event.platform, event.data.guild_id, newTopic);
  deps.configCache.invalidate(deps.cacheKey(event.platform, event.data.guild_id));

  const syncedText = renderHoneypotMessage({
    platform: config.platform,
    action: config.action,
    detectionCount: config.detectionCount,
    customMessage: newTopic,
  });

  const globalCount = await deps.store.getGlobalDetectionCount();
  const components = renderHoneypotWarningComponents(config.detectionCount, globalCount);

  if (config.warningMessageId !== undefined) {
    const editRes = await deps.messagingPort.editMessage({
      platform: config.platform,
      channelId: config.channelId,
      messageId: config.warningMessageId,
      content: syncedText,
      components,
    });
    if (editRes.ok) {
      return;
    }
  }

  const sendRes = await deps.messagingPort.sendMessage({
    platform: config.platform,
    channelId: config.channelId,
    content: syncedText,
    components,
  });
  if (sendRes.ok) {
    await deps.store.updateWarningMessageId(event.platform, event.data.guild_id, sendRes.value);
    deps.configCache.invalidate(deps.cacheKey(config.platform, event.data.guild_id));
  }
}
