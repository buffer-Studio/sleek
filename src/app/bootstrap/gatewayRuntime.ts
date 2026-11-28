import type {createNativeGatewayDriver} from '../../adapters/native/nativeGateway.driver';
import type {PlatformId} from '../../base/common/platformId';
import type {CommandRegistry} from '../../core/commands/commandRegistry';
import type {EventBus} from '../../core/events/eventBus';
import type {GuildHierarchyCache} from '../../core/hierarchy/guildHierarchyCache';
import {DEFAULT_EVENT_INTEREST, EVENT_INTEREST} from '../../core/ports/gateway.port';
import type {InteractionPort} from '../../core/ports/interaction.port';
import type {MessagingPort} from '../../core/ports/messaging.port';
import type {GovernanceService} from '../../modules/governance/governance.contract';
import type {SecurityService} from '../../modules/security/security.contract';
import type {parseEnv} from '../../platform/config/envSchema';
import type {SleekConfigStore} from '../../platform/config/sleekConfig';
import type {StructuredLogger} from '../../platform/logger/structuredLogger';
import {type ChildToParentMessage, parentToChildMessageSchema} from '../cluster/clusterIpc';
import {dispatchPrefixMessage} from './commandDispatcher';
import {dispatchInteraction} from './interactionDispatcher';

const DISCORD_BASE_INTENTS = 513 | (1 << 15);
const DISCORD_GUILD_MEMBERS_INTENT = 1 << 1;

function sendIpc(msg: ChildToParentMessage): void {
  if (typeof process.send === 'function') {
    process.send(msg);
  }
}

export interface GatewayRuntimeOptions {
  readonly env: ReturnType<typeof parseEnv>;
  readonly logger: StructuredLogger;
  readonly eventBus: EventBus;
  readonly gateway: ReturnType<typeof createNativeGatewayDriver>;
  readonly discordToken: string | undefined;
  readonly commandRegistry: CommandRegistry;
  readonly security: SecurityService;
  readonly governance: GovernanceService;
  readonly configStore: SleekConfigStore;
  readonly hierarchyCache: GuildHierarchyCache;
  readonly messagingPort: MessagingPort;
  readonly interactionPort: InteractionPort;
  readonly onShutdown: (signal: string, exitCode?: number) => Promise<void>;
}

export function startGatewayRuntime(options: GatewayRuntimeOptions): void {
  const {
    env,
    logger,
    eventBus,
    gateway,
    discordToken,
    commandRegistry,
    security,
    governance,
    configStore,
    hierarchyCache,
    messagingPort,
    interactionPort,
    onShutdown,
  } = options;

  const hasParentIpc = typeof process.send === 'function';
  let guildCount = 0;
  const botUserIdsByPlatform = new Map<PlatformId, string>();

  eventBus.subscribe('READY', event => {
    if (event.data.user?.id !== undefined) {
      botUserIdsByPlatform.set(event.platform, event.data.user.id);
    }
    const shardGuilds = event.data.guilds?.length ?? 0;
    guildCount += shardGuilds;
    logger.info(`${event.platform}.gateway.ready`, {
      clusterId: env.CLUSTER_ID,
      shardId: event.shardId,
      shardGuilds,
    });
    sendIpc({
      type: 'ready',
      platform: event.platform,
      shardId: event.shardId,
      guildCount: shardGuilds,
    });
  });

  eventBus.subscribe('MESSAGE_CREATE', async event => {
    if (event.data.author.bot === true) {
      return;
    }
    const guildOwnerId =
      event.data.guild_id !== undefined
        ? await hierarchyCache.resolveGuildOwnerId(event.platform, event.data.guild_id)
        : undefined;

    await dispatchPrefixMessage(
      {commandRegistry, security, governance, configStore},
      {
        platform: event.platform,
        guildId: event.data.guild_id,
        channelId: event.data.channel_id,
        actorId: event.data.author.id,
        actorRoleIds: event.data.member?.roles ?? [],
        guildOwnerId,
        content: event.data.content,
        botUserId: botUserIdsByPlatform.get(event.platform),
        reply: async content => {
          await messagingPort.sendMessage({
            platform: event.platform,
            channelId: event.data.channel_id,
            content,
          });
        },
      },
    );
  });

  eventBus.subscribe('INTERACTION_CREATE', async event => {
    await dispatchInteraction(
      {
        commandRegistry,
        security,
        interactionPort,
        hierarchyCache,
      },
      event.platform,
      event.data,
    );
  });

  eventBus.subscribe('GATEWAY_FATAL_CLOSE', event => {
    logger.error(`${event.platform}.gateway.fatal_close`, {
      clusterId: env.CLUSTER_ID,
      shardId: event.shardId,
      code: event.data.code,
      reason: event.data.reason,
    });
    sendIpc({
      type: 'fatalClose',
      platform: event.platform,
      shardId: event.shardId,
      code: event.data.code,
      reason: event.data.reason,
    });
  });

  eventBus.subscribe('GATEWAY_CLOSED', event => {
    logger.warn(`${event.platform}.gateway.closed`, {
      clusterId: env.CLUSTER_ID,
      shardId: event.shardId,
      code: event.data.code,
      reason: event.data.reason,
    });
  });

  if (hasParentIpc) {
    process.on('message', (rawMessage: unknown) => {
      const parsed = parentToChildMessageSchema.safeParse(rawMessage);
      if (!parsed.success) {
        return;
      }
      const msg = parsed.data;
      if (msg.type === 'identifyGrant') {
        gateway.grantIdentify(msg.platform, msg.shardId);
      } else if (msg.type === 'shutdown') {
        void onShutdown(msg.reason, 0);
      } else {
        sendIpc({
          type: 'stats',
          clusterId: env.CLUSTER_ID,
          guildCount,
          rssBytes: process.memoryUsage().rss,
        });
      }
    });
  }

  const discordIntents =
    DISCORD_BASE_INTENTS | (env.enableDiscordGuildMembersIntent ? DISCORD_GUILD_MEMBERS_INTENT : 0);
  const interestMask =
    DEFAULT_EVENT_INTEREST |
    (env.enableDiscordGuildMembersIntent ? EVENT_INTEREST.GUILD_MEMBERS : 0);

  gateway.start(
    {
      discordToken,
      discordIntents,
      discordShardStart: env.DISCORD_SHARD_START,
      discordShardEnd: env.DISCORD_SHARD_END,
      discordTotalShards: env.DISCORD_TOTAL_SHARDS,
      interestMask,
    },
    batch => {
      if (batch.droppedCount > 0) {
        logger.warn('gateway.batch.shed', {droppedCount: batch.droppedCount});
      }
      void eventBus.publishRawBatch(batch);
    },
    hasParentIpc
      ? (req): void => {
          sendIpc({
            type: 'identifyRequest',
            platform: req.platform,
            shardId: req.shardId,
          });
        }
      : undefined,
  );
}
