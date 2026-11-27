import {verifyDiscordGateway} from '../adapters/discord/discord.adapter';
import {syncDiscordSlashCommands} from '../adapters/discord/discordSlashSync';
import {resolveFluxerGatewayUrl} from '../adapters/fluxer/fluxer.adapter';
import {loadNativeAddon} from '../adapters/native/addonLoader';
import {createNativeGatewayDriver} from '../adapters/native/nativeGateway.driver';
import {createRestClient} from '../adapters/rest/restClient';
import {createRestPorts} from '../adapters/rest/restPorts.adapter';
import {ShutdownCoordinator} from '../base/bun/shutdownCoordinator';
import {ShutdownPhase} from '../base/bun/shutdownPhase';
import type {PlatformId} from '../base/common/platformId';
import {createEventBus} from '../core/events/eventBus';
import {createGuildHierarchyCache} from '../core/hierarchy/guildHierarchyCache';
import {DEFAULT_EVENT_INTEREST, EVENT_INTEREST} from '../core/ports/gateway.port';
import {DEV_SLASH_COMMANDS, RELOAD_CONTROL_CHANNEL} from '../modules/developer/developer.module';
import {
  createPgGovernanceStore,
  GOVERNANCE_SERVICE_KEY,
} from '../modules/governance/governance.contract';
import {HONEYPOT_MODULE_KEY, HONEYPOT_SLASH_COMMANDS} from '../modules/honeypot/honeypot.contract';
import {registerCoreModules} from '../modules/manifest';
import {
  createPgSecurityStore,
  SECURITY_SERVICE_KEY,
  SECURITY_SLASH_COMMANDS,
} from '../modules/security/security.contract';
import {createValkeyClient} from '../platform/cache/valkeyClient';
import {parseEnv} from '../platform/config/envSchema';
import {loadSleekConfig, SleekConfigStore} from '../platform/config/sleekConfig';
import {createDrizzleClient} from '../platform/database/drizzleClient';
import {ServiceRegistry} from '../platform/di/serviceRegistry';
import {createRunLogFilePath, createStructuredLogger} from '../platform/logger/structuredLogger';
import {createPgQueueRunner} from '../platform/queue/pgQueueRunner';
import {dispatchPrefixMessage} from './bootstrap/commandDispatcher';
import {dispatchInteraction} from './bootstrap/interactionDispatcher';
import {type ChildToParentMessage, parentToChildMessageSchema} from './cluster/clusterIpc';

const DISCORD_BASE_INTENTS = 513 | (1 << 15);
const DISCORD_GUILD_MEMBERS_INTENT = 1 << 1;

function sendIpc(msg: ChildToParentMessage): void {
  if (typeof process.send === 'function') {
    process.send(msg);
  }
}

export async function main(): Promise<void> {
  const env = parseEnv();
  const isDev = env.NODE_ENV === 'development';
  const logFilePath = createRunLogFilePath(process.cwd(), env.CLUSTER_ID);
  const logger = createStructuredLogger({
    minLevel: isDev ? 'debug' : env.LOG_LEVEL,
    logFilePath,
    prettyConsole: isDev,
  });

  logger.info('sleek.startup', {
    clusterId: env.CLUSTER_ID,
    nodeEnv: env.NODE_ENV,
    runtimeMode: env.SLEEK_RUNTIME_MODE,
    discordShards: `${env.DISCORD_SHARD_START}..${env.DISCORD_SHARD_END}/${env.DISCORD_TOTAL_SHARDS}`,
    logFilePath,
  });

  const policyConfig = await loadSleekConfig(env.SLEEK_CONFIG_PATH);
  const configStore = new SleekConfigStore(policyConfig, env.SLEEK_CONFIG_PATH);
  const shutdownCoordinator = new ShutdownCoordinator();
  const serviceRegistry = new ServiceRegistry();

  const database = createDrizzleClient({
    databaseUrl: env.DATABASE_URL,
    poolMax: env.PG_POOL_MAX,
    prepare: env.pgPrepare,
  });
  shutdownCoordinator.register({
    name: 'postgres',
    phase: ShutdownPhase.DataStores,
    run: async () => database.disposeAsync(),
  });

  const valkey = await createValkeyClient(env.VALKEY_URL);
  shutdownCoordinator.register({
    name: 'valkey',
    phase: ShutdownPhase.DataStores,
    run: async () => valkey.disposeAsync(),
  });

  const addonResult = loadNativeAddon();
  if (!addonResult.ok) {
    logger.error('native.addon.load_failed', {
      code: addonResult.error.code,
      message: addonResult.error.message,
    });
    process.exit(1);
  }

  let discordToken: string | undefined;
  if (env.DISCORD_TOKEN !== undefined && env.DISCORD_TOKEN.length > 0) {
    discordToken = env.DISCORD_TOKEN;
    const devGuildId = env.devGuildIdsByPlatform.discord;
    if (
      env.enableDevSlashSync &&
      devGuildId !== undefined &&
      env.SKIP_STARTUP_SYNC !== 'true' &&
      env.DISCORD_APPLICATION_ID !== undefined &&
      env.DISCORD_APPLICATION_ID.length > 0
    ) {
      await syncDiscordSlashCommands({
        token: discordToken,
        applicationId: env.DISCORD_APPLICATION_ID,
        guildId: devGuildId,
        commands: DEV_SLASH_COMMANDS,
        logger,
      });
    }
    if (
      env.SKIP_STARTUP_SYNC !== 'true' &&
      env.DISCORD_APPLICATION_ID !== undefined &&
      env.DISCORD_APPLICATION_ID.length > 0
    ) {
      await syncDiscordSlashCommands({
        token: discordToken,
        applicationId: env.DISCORD_APPLICATION_ID,
        commands: [...HONEYPOT_SLASH_COMMANDS, ...SECURITY_SLASH_COMMANDS],
        logger,
      });
    }
    if (env.SKIP_STARTUP_SYNC !== 'true') {
      await verifyDiscordGateway({token: discordToken, logger});
    }
  } else {
    logger.warn('discord.skipped', {reason: 'DISCORD_TOKEN not set'});
  }

  let fluxerToken: string | undefined;
  let fluxerWsUrl: string | undefined;
  if (env.FLUXER_TOKEN !== undefined && env.FLUXER_TOKEN.length > 0) {
    fluxerToken = env.FLUXER_TOKEN;
    fluxerWsUrl = await resolveFluxerGatewayUrl({
      token: fluxerToken,
      apiBaseUrl: env.FLUXER_API_BASE_URL,
      logger,
    });
  } else {
    logger.warn('fluxer.skipped', {reason: 'FLUXER_TOKEN not set'});
  }

  const eventBus = createEventBus(logger);
  const restClient = createRestClient({
    discordToken,
    fluxerToken,
    fluxerApiBaseUrl: env.FLUXER_API_BASE_URL,
    valkey,
    logger,
  });
  shutdownCoordinator.register({
    name: 'rest-client',
    phase: ShutdownPhase.Workers,
    run: () => {
      restClient.dispose();
    },
  });

  const hierarchyCache = createGuildHierarchyCache({
    eventBus,
    valkey,
    fetchGuildMetadata: async (platform: PlatformId, guildId: string) => {
      const res = await restClient.request<{
        readonly name?: string | null;
        readonly vanity_url_code?: string | null;
        readonly owner_id?: string;
        readonly roles?: ReadonlyArray<{readonly id: string; readonly position: number}>;
      }>({
        platform,
        method: 'GET',
        path: `/guilds/${guildId}`,
        routeKey: 'guilds/:guildId',
        majorParam: guildId,
      });
      if (!res.ok) {
        return undefined;
      }
      return {
        name: res.value.name ?? undefined,
        vanityCode: res.value.vanity_url_code ?? undefined,
        ownerId: res.value.owner_id,
        roles: res.value.roles ?? [],
      };
    },
    fetchMemberRoles: async (platform: PlatformId, guildId: string, userId: string) => {
      const res = await restClient.request<{readonly roles?: readonly string[]}>({
        platform,
        method: 'GET',
        path: `/guilds/${guildId}/members/${userId}`,
        routeKey: 'guilds/:guildId/members/:userId',
        majorParam: guildId,
      });
      if (!res.ok) {
        if (res.error.code === 'not_found') {
          return {found: false, roles: []};
        }
        return undefined;
      }
      return {found: true, roles: res.value.roles ?? []};
    },
  });
  shutdownCoordinator.register({
    name: 'hierarchy-cache',
    phase: ShutdownPhase.Workers,
    run: () => {
      hierarchyCache.dispose();
    },
  });

  const {messagingPort, rolePort, moderationPort, channelPort, interactionPort} = createRestPorts({
    restClient,
    onMemberRolesMutated: (platform, guildId, userId) => {
      hierarchyCache.invalidateMemberRoles(platform, guildId, userId);
    },
  });

  const queuePort = createPgQueueRunner({
    database,
    valkey,
    clusterId: env.CLUSTER_ID,
    logger,
  });
  await queuePort.start();
  shutdownCoordinator.register({
    name: 'pg-queue',
    phase: ShutdownPhase.Workers,
    run: async () => queuePort.disposeAsync(),
  });

  const commandRegistry = registerCoreModules({
    registry: serviceRegistry,
    securityStore: createPgSecurityStore(database),
    governanceStore: createPgGovernanceStore(database),
    valkey,
    database,
    configStore,
    botOwnersByPlatform: env.botOwnersByPlatform,
    rolePort,
    messagingPort,
    moderationPort,
    channelPort,
    interactionPort,
    eventBus,
    queuePort,
    hierarchyCache,
    logger,
  });

  const security = serviceRegistry.resolve(SECURITY_SERVICE_KEY);
  const governance = serviceRegistry.resolve(GOVERNANCE_SERVICE_KEY);
  const honeypot = serviceRegistry.has(HONEYPOT_MODULE_KEY)
    ? serviceRegistry.resolve(HONEYPOT_MODULE_KEY)
    : undefined;
  if (honeypot !== undefined) {
    shutdownCoordinator.register({
      name: 'honeypot-module',
      phase: ShutdownPhase.Ingress,
      run: () => {
        honeypot.dispose();
      },
    });
  }

  await valkey.subscribe(RELOAD_CONTROL_CHANNEL, () => {
    void configStore.reload().then(() => {
      security.flushAllCaches();
      governance.flushAllCaches();
      honeypot?.flushAllCaches();
    });
  });

  const gateway = createNativeGatewayDriver(addonResult.value);
  shutdownCoordinator.register({
    name: 'native-gateway',
    phase: ShutdownPhase.Ingress,
    run: () => {
      gateway.stop(3000);
    },
  });

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

  async function shutdown(signal: string, exitCode = 0): Promise<void> {
    logger.info('sleek.shutdown', {clusterId: env.CLUSTER_ID, signal});
    await shutdownCoordinator.shutdown(12_000);
    process.exit(exitCode);
  }

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
        void shutdown(msg.reason, 0);
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
      fluxerToken,
      fluxerWsUrl,
      fluxerShardStart: env.FLUXER_SHARD_START,
      fluxerShardEnd: env.FLUXER_SHARD_END,
      fluxerTotalShards: env.FLUXER_TOTAL_SHARDS,
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

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
