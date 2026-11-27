import {z} from 'zod';

import {syncDiscordSlashCommands} from '../../adapters/discord/discordSlashSync';
import {
  type ClusterAssignment,
  computeClusterPlan,
  computeTotalShards,
} from '../../core/math/shardingMath';
import {buildChildProcessEnv, parseEnv} from '../../platform/config/envSchema';
import {createRunLogFilePath, createStructuredLogger} from '../../platform/logger/structuredLogger';
import {childToParentMessageSchema, type ParentToChildMessage} from './clusterIpc';
import {createIdentifyCoordinator} from './identifyCoordinator';

const gatewayBotSchema = z.object({
  shards: z.number().int().min(1).default(1),
  session_start_limit: z
    .object({
      max_concurrency: z.number().int().min(1).default(1),
    })
    .optional(),
});

const appMeSchema = z.object({
  approximate_guild_count: z.number().int().min(0).optional(),
});

interface ManagedCluster {
  readonly assignment: ClusterAssignment;
  proc?: ReturnType<typeof Bun.spawn>;
  restarts: number;
  fatalHalted: boolean;
}

async function fetchDiscordBootstrapInfo(
  token: string,
): Promise<{recommendedShards: number; maxConcurrency: number; approximateGuilds: number}> {
  const [gwRes, appRes] = await Promise.all([
    fetch('https://discord.com/api/v10/gateway/bot', {
      headers: {Authorization: `Bot ${token}`},
    }),
    fetch('https://discord.com/api/v10/applications/@me', {
      headers: {Authorization: `Bot ${token}`},
    }),
  ]);

  if (!gwRes.ok) {
    throw new Error(`Discord /gateway/bot failed (${gwRes.status}): ${await gwRes.text()}`);
  }
  const gw = gatewayBotSchema.parse(await gwRes.json());
  let approximateGuilds = 0;
  if (appRes.ok) {
    const app = appMeSchema.safeParse(await appRes.json());
    if (app.success && app.data.approximate_guild_count !== undefined) {
      approximateGuilds = app.data.approximate_guild_count;
    }
  }

  return {
    recommendedShards: gw.shards,
    maxConcurrency: gw.session_start_limit?.max_concurrency ?? 1,
    approximateGuilds,
  };
}

export async function runClusterManager(): Promise<void> {
  const env = parseEnv();
  const isDev = env.NODE_ENV === 'development';
  const logger = createStructuredLogger({
    minLevel: isDev ? 'debug' : env.LOG_LEVEL,
    logFilePath: createRunLogFilePath(process.cwd(), 'manager'),
    prettyConsole: isDev,
  });

  let recommendedShards = 1;
  let maxConcurrency = 1;
  let guildCount = env.ESTIMATED_DISCORD_GUILDS;

  if (env.DISCORD_TOKEN !== undefined && env.DISCORD_TOKEN.length > 0) {
    const devGuildId = env.devGuildIdsByPlatform.discord;
    if (
      env.enableDevSlashSync &&
      devGuildId !== undefined &&
      env.DISCORD_APPLICATION_ID !== undefined &&
      env.DISCORD_APPLICATION_ID.length > 0
    ) {
      await syncDiscordSlashCommands({
        token: env.DISCORD_TOKEN,
        applicationId: env.DISCORD_APPLICATION_ID,
        guildId: devGuildId,
        commands: [],
        logger,
      });
    }
    const info = await fetchDiscordBootstrapInfo(env.DISCORD_TOKEN);
    recommendedShards = info.recommendedShards;
    maxConcurrency = info.maxConcurrency;
    guildCount = Math.max(guildCount, info.approximateGuilds);
  }

  const totalDiscordShards = computeTotalShards(
    guildCount,
    recommendedShards,
    env.GUILDS_PER_SHARD,
  );
  const totalFluxerShards = computeTotalShards(
    env.ESTIMATED_FLUXER_GUILDS,
    1,
    env.GUILDS_PER_SHARD,
  );
  const assignments = computeClusterPlan(totalDiscordShards, env.SHARDS_PER_CLUSTER);
  const coordinator = createIdentifyCoordinator({maxConcurrency});

  logger.info('cluster.manager.plan', {
    totalDiscordShards,
    totalFluxerShards,
    maxConcurrency,
    clusters: assignments.length,
  });

  let shuttingDown = false;
  const clusters: ManagedCluster[] = assignments.map(assignment => ({
    assignment,
    restarts: 0,
    fatalHalted: false,
  }));

  function sendToChild(child: ReturnType<typeof Bun.spawn>, msg: ParentToChildMessage): void {
    child.send(msg);
  }

  function spawnCluster(managed: ManagedCluster): void {
    if (shuttingDown || managed.fatalHalted) {
      return;
    }
    const {assignment} = managed;
    const isClusterZero = assignment.clusterIndex === 0;

    const childEnv = buildChildProcessEnv({
      CLUSTER_ID: assignment.clusterId,
      DISCORD_SHARD_START: String(assignment.shardStart),
      DISCORD_SHARD_END: String(assignment.shardEnd),
      DISCORD_TOTAL_SHARDS: String(assignment.totalShards),
      FLUXER_SHARD_START: isClusterZero ? '0' : '0',
      FLUXER_SHARD_END: isClusterZero ? String(totalFluxerShards - 1) : '0',
      FLUXER_TOTAL_SHARDS: String(totalFluxerShards),
      FLUXER_TOKEN: isClusterZero ? env.FLUXER_TOKEN : undefined,
      SKIP_STARTUP_SYNC: 'true',
    });

    const proc = Bun.spawn(['bun', 'run', 'src/app/main.ts'], {
      env: childEnv,
      stdout: 'inherit',
      stderr: 'inherit',
      ipc: (rawMessage: unknown, childProc) => {
        const parsed = childToParentMessageSchema.safeParse(rawMessage);
        if (!parsed.success) {
          return;
        }
        const msg = parsed.data;
        if (msg.type === 'identifyRequest') {
          coordinator.enqueue(msg.platform, msg.shardId, () => {
            sendToChild(childProc, {
              type: 'identifyGrant',
              platform: msg.platform,
              shardId: msg.shardId,
            });
          });
        } else if (msg.type === 'fatalClose') {
          managed.fatalHalted = true;
          logger.error('cluster.fatal_close', {
            clusterId: assignment.clusterId,
            platform: msg.platform,
            shardId: msg.shardId,
            code: msg.code,
            reason: msg.reason,
          });
        } else if (msg.type === 'ready') {
          managed.restarts = 0;
          logger.info('cluster.shard.ready', {
            clusterId: assignment.clusterId,
            platform: msg.platform,
            shardId: msg.shardId,
            guildCount: msg.guildCount,
          });
        } else {
          logger.info('cluster.stats', msg);
        }
      },
    });

    managed.proc = proc;
    logger.info('cluster.spawned', {
      clusterId: assignment.clusterId,
      pid: proc.pid,
      discordShards: `${assignment.shardStart}..${assignment.shardEnd}`,
      fluxerEnabled: isClusterZero && env.FLUXER_TOKEN !== undefined,
    });

    void proc.exited.then(exitCode => {
      if (shuttingDown || managed.fatalHalted) {
        return;
      }
      managed.restarts += 1;
      const backoffMs = Math.min(30_000, 1000 * 2 ** (managed.restarts - 1));
      logger.warn('cluster.exited', {
        clusterId: assignment.clusterId,
        exitCode,
        restartInMs: backoffMs,
      });
      setTimeout(() => {
        spawnCluster(managed);
      }, backoffMs);
    });
  }

  for (const managed of clusters) {
    spawnCluster(managed);
  }

  function shutdownAll(signal: string): void {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info('cluster.manager.shutdown', {signal});
    for (const managed of clusters) {
      if (managed.proc !== undefined) {
        sendToChild(managed.proc, {type: 'shutdown', reason: signal});
      }
    }
    setTimeout(() => {
      for (const managed of clusters) {
        managed.proc?.kill();
      }
      process.exit(0);
    }, 3500);
  }

  process.on('SIGINT', () => {
    shutdownAll('SIGINT');
  });
  process.on('SIGTERM', () => {
    shutdownAll('SIGTERM');
  });
}

if (import.meta.main) {
  runClusterManager().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
