import {z} from 'zod';

import type {PlatformId} from '../../base/common/platformId';

const SNOWFLAKE_REGEX = /^\d{17,20}$/;

function parseSnowflakeList(raw: string | undefined): readonly string[] {
  if (raw === undefined || raw.trim().length === 0) {
    return [];
  }
  return raw
    .split(',')
    .map(item => item.trim())
    .filter(item => item.length > 0);
}

const optionalSnowflakeSchema = z
  .string()
  .optional()
  .transform(val => (val !== undefined && val.trim().length > 0 ? val.trim() : undefined))
  .refine(val => val === undefined || SNOWFLAKE_REGEX.test(val), {
    error: 'Must be a 17-20 digit snowflake ID',
  });

const snowflakeListSchema = z
  .string()
  .optional()
  .superRefine((raw, ctx) => {
    const items = parseSnowflakeList(raw);
    for (const item of items) {
      if (!SNOWFLAKE_REGEX.test(item)) {
        ctx.addIssue({
          code: 'custom',
          message: `Invalid snowflake ID '${item}' (expected 17-20 digits)`,
        });
      }
    }
  })
  .transform(raw => parseSnowflakeList(raw));

const rawEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  SLEEK_RUNTIME_MODE: z.enum(['allInOne', 'gatewayOnly', 'workerOnly']).default('allInOne'),
  DISCORD_TOKEN: z.string().optional(),
  DISCORD_APPLICATION_ID: z.string().optional(),
  FLUXER_TOKEN: z.string().optional(),
  FLUXER_API_BASE_URL: z.url().default('https://api.fluxer.app/v1'),
  CLUSTER_ID: z.string().default('C0'),
  DISCORD_SHARD_START: z.coerce.number().int().min(0).default(0),
  DISCORD_SHARD_END: z.coerce.number().int().min(0).default(0),
  DISCORD_TOTAL_SHARDS: z.coerce.number().int().min(1).default(1),
  FLUXER_SHARD_START: z.coerce.number().int().min(0).default(0),
  FLUXER_SHARD_END: z.coerce.number().int().min(0).default(0),
  FLUXER_TOTAL_SHARDS: z.coerce.number().int().min(1).default(1),
  SHARDS_PER_CLUSTER: z.coerce.number().int().min(1).default(4),
  GUILDS_PER_SHARD: z.coerce.number().int().min(1).default(500),
  ESTIMATED_DISCORD_GUILDS: z.coerce.number().int().min(0).default(0),
  ESTIMATED_FLUXER_GUILDS: z.coerce.number().int().min(0).default(0),
  SKIP_STARTUP_SYNC: z.enum(['true', 'false']).default('false'),
  DATABASE_URL: z.string().default('postgresql://sleek:sleek@localhost:5432/sleek'),
  VALKEY_URL: z.string().default('redis://localhost:6379'),
  PG_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  PG_PREPARE: z.enum(['true', 'false']).default('false'),
  ENABLE_HTTP_INGRESS: z.enum(['true', 'false']).default('false'),
  HTTP_HOST: z.string().default('0.0.0.0'),
  HTTP_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  TOPGG_WEBHOOK_AUTH: z.string().optional(),
  SENTRY_DSN: z.string().optional(),
  DISCORD_BOT_OWNER_IDS: snowflakeListSchema,
  FLUXER_BOT_OWNER_IDS: snowflakeListSchema,
  DISCORD_DEV_GUILD_ID: optionalSnowflakeSchema,
  FLUXER_DEV_GUILD_ID: optionalSnowflakeSchema,
  ENABLE_DEV_SLASH_SYNC: z.enum(['true', 'false']).default('false'),
  DISCORD_ENABLE_GUILD_MEMBERS_INTENT: z.enum(['true', 'false']).default('false'),
  SLEEK_CONFIG_PATH: z.string().default('config/sleek.yaml'),
  RUN_LIVE_INFRA_TESTS: z.enum(['0', '1']).default('0'),
});

export interface EnvConfig {
  readonly NODE_ENV: 'development' | 'production' | 'test';
  readonly LOG_LEVEL: 'debug' | 'info' | 'warn' | 'error';
  readonly SLEEK_RUNTIME_MODE: 'allInOne' | 'gatewayOnly' | 'workerOnly';
  readonly DISCORD_TOKEN: string | undefined;
  readonly DISCORD_APPLICATION_ID: string | undefined;
  readonly FLUXER_TOKEN: string | undefined;
  readonly FLUXER_API_BASE_URL: string;
  readonly CLUSTER_ID: string;
  readonly DISCORD_SHARD_START: number;
  readonly DISCORD_SHARD_END: number;
  readonly DISCORD_TOTAL_SHARDS: number;
  readonly FLUXER_SHARD_START: number;
  readonly FLUXER_SHARD_END: number;
  readonly FLUXER_TOTAL_SHARDS: number;
  readonly SHARDS_PER_CLUSTER: number;
  readonly GUILDS_PER_SHARD: number;
  readonly ESTIMATED_DISCORD_GUILDS: number;
  readonly ESTIMATED_FLUXER_GUILDS: number;
  readonly SKIP_STARTUP_SYNC: 'true' | 'false';
  readonly DATABASE_URL: string;
  readonly VALKEY_URL: string;
  readonly PG_POOL_MAX: number;
  readonly pgPrepare: boolean;
  readonly enableHttpIngress: boolean;
  readonly HTTP_HOST: string;
  readonly HTTP_PORT: number;
  readonly TOPGG_WEBHOOK_AUTH: string | undefined;
  readonly SENTRY_DSN: string | undefined;
  readonly botOwnersByPlatform: Readonly<Record<PlatformId, ReadonlySet<string>>>;
  readonly devGuildIdsByPlatform: Readonly<Record<PlatformId, string | undefined>>;
  readonly enableDevSlashSync: boolean;
  readonly enableDiscordGuildMembersIntent: boolean;
  readonly SLEEK_CONFIG_PATH: string;
  readonly runLiveInfraTests: boolean;
}

export function parseEnv(raw: Record<string, string | undefined> = Bun.env): EnvConfig {
  const result = rawEnvSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map(issue => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${issues}`);
  }

  const data = result.data;
  const botOwnersByPlatform: Readonly<Record<PlatformId, ReadonlySet<string>>> = Object.freeze({
    discord: new Set(data.DISCORD_BOT_OWNER_IDS),
    fluxer: new Set(data.FLUXER_BOT_OWNER_IDS),
  });
  const devGuildIdsByPlatform: Readonly<Record<PlatformId, string | undefined>> = Object.freeze({
    discord: data.DISCORD_DEV_GUILD_ID,
    fluxer: data.FLUXER_DEV_GUILD_ID,
  });

  return Object.freeze({
    NODE_ENV: data.NODE_ENV,
    LOG_LEVEL: data.LOG_LEVEL,
    SLEEK_RUNTIME_MODE: data.SLEEK_RUNTIME_MODE,
    DISCORD_TOKEN: data.DISCORD_TOKEN,
    DISCORD_APPLICATION_ID: data.DISCORD_APPLICATION_ID,
    FLUXER_TOKEN: data.FLUXER_TOKEN,
    FLUXER_API_BASE_URL: data.FLUXER_API_BASE_URL,
    CLUSTER_ID: data.CLUSTER_ID,
    DISCORD_SHARD_START: data.DISCORD_SHARD_START,
    DISCORD_SHARD_END: data.DISCORD_SHARD_END,
    DISCORD_TOTAL_SHARDS: data.DISCORD_TOTAL_SHARDS,
    FLUXER_SHARD_START: data.FLUXER_SHARD_START,
    FLUXER_SHARD_END: data.FLUXER_SHARD_END,
    FLUXER_TOTAL_SHARDS: data.FLUXER_TOTAL_SHARDS,
    SHARDS_PER_CLUSTER: data.SHARDS_PER_CLUSTER,
    GUILDS_PER_SHARD: data.GUILDS_PER_SHARD,
    ESTIMATED_DISCORD_GUILDS: data.ESTIMATED_DISCORD_GUILDS,
    ESTIMATED_FLUXER_GUILDS: data.ESTIMATED_FLUXER_GUILDS,
    SKIP_STARTUP_SYNC: data.SKIP_STARTUP_SYNC,
    DATABASE_URL: data.DATABASE_URL,
    VALKEY_URL: data.VALKEY_URL,
    PG_POOL_MAX: data.PG_POOL_MAX,
    pgPrepare: data.PG_PREPARE === 'true',
    enableHttpIngress: data.ENABLE_HTTP_INGRESS === 'true',
    HTTP_HOST: data.HTTP_HOST,
    HTTP_PORT: data.HTTP_PORT,
    TOPGG_WEBHOOK_AUTH: data.TOPGG_WEBHOOK_AUTH,
    SENTRY_DSN: data.SENTRY_DSN,
    botOwnersByPlatform,
    devGuildIdsByPlatform,
    enableDevSlashSync: data.ENABLE_DEV_SLASH_SYNC === 'true',
    enableDiscordGuildMembersIntent: data.DISCORD_ENABLE_GUILD_MEMBERS_INTENT === 'true',
    SLEEK_CONFIG_PATH: data.SLEEK_CONFIG_PATH,
    runLiveInfraTests: data.RUN_LIVE_INFRA_TESTS === '1',
  });
}

export function buildChildProcessEnv(
  overrides: Readonly<Record<string, string | undefined>>,
): Record<string, string | undefined> {
  return {
    ...Bun.env,
    ...overrides,
  };
}
