import {parse as parseYaml} from 'yaml';
import {z} from 'zod';

const velocityWindowSchema = z.object({
  limit: z.number().int().min(1),
  windowSeconds: z.number().int().min(1),
});

const sleekYamlSchema = z.object({
  version: z.number().int().min(1).default(1),
  prefixes: z.object({
    defaultPrefix: z.string().min(1).max(5).default(','),
    maxLength: z.number().int().min(1).max(10).default(5),
    allowMentionFallback: z.boolean().default(true),
  }),
  cooldowns: z.object({
    defaultMs: z.number().int().min(0).default(4000),
    burstMaxCount: z.number().int().min(1).default(5),
    burstWindowMs: z.number().int().min(500).default(5000),
    floodLockMs: z.number().int().min(1000).default(10_000),
    severeAbuseThreshold: z.number().int().min(1).default(8),
    countRejectedInBurst: z.boolean().default(true),
    commandOverridesMs: z.record(z.string(), z.number().int().min(0)).default({}),
  }),
  security: z.object({
    freeBindingCapPerGuild: z.number().int().min(1).default(25),
    maxBoundAdminsPerGuild: z.number().int().min(1).default(5),
    maxActingOwnerTrustDays: z.number().int().min(1).max(365).default(30),
    velocityTripwires: z.object({
      level1: velocityWindowSchema,
      level2: velocityWindowSchema,
      level3: z.object({
        burstLimit: z.number().int().min(1).default(15),
        burstWindowSeconds: z.number().int().min(1).default(60),
        sustainedLimit: z.number().int().min(1).default(40),
        sustainedWindowSeconds: z.number().int().min(1).default(3600),
      }),
      level4: velocityWindowSchema,
    }),
    actingOwnerHardBounds: z.object({
      burstMin: z.number().int().min(1).default(10),
      burstMax: z.number().int().min(1).default(30),
      sustainedMin: z.number().int().min(1).default(30),
      sustainedMax: z.number().int().min(1).default(120),
    }),
  }),
  aliases: z.object({
    freeGuildAliasCap: z.number().int().min(0).default(3),
    maxMacroSteps: z.number().int().min(1).max(10).default(3),
    requireVoteForPersonalAliases: z.boolean().default(false),
    personalAliasCapNoVote: z.number().int().min(0).default(5),
  }),
  developer: z.object({
    bypassCooldowns: z.boolean().default(true),
    bypassDisabledChecks: z.boolean().default(true),
    bypassIgnoreLists: z.boolean().default(true),
    bypassGuildFakePermissions: z.boolean().default(true),
    allowOverrideTrueOwnerInBot: z.boolean().default(true),
    sqlTimeoutMs: z.number().int().min(100).max(30_000).default(3000),
    sqlMaxRows: z.number().int().min(1).max(500).default(50),
  }),
});

export type SleekPolicyConfig = z.infer<typeof sleekYamlSchema>;

export function parseSleekConfigYaml(rawYaml: string): SleekPolicyConfig {
  const parsedYaml: unknown = parseYaml(rawYaml);
  const result = sleekYamlSchema.safeParse(parsedYaml);
  if (!result.success) {
    const issues = result.error.issues
      .map(issue => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid YAML policy configuration: ${issues}`);
  }
  return Object.freeze(result.data);
}

export async function loadSleekConfig(filePath: string): Promise<SleekPolicyConfig> {
  const file = Bun.file(filePath);
  const exists = await file.exists();
  if (!exists) {
    throw new Error(`Sleek YAML configuration file not found at: ${filePath}`);
  }
  const content = await file.text();
  return parseSleekConfigYaml(content);
}

export class SleekConfigStore {
  private current: SleekPolicyConfig;
  private readonly filePath: string | undefined;
  private readonly listeners = new Set<(next: SleekPolicyConfig) => void>();

  constructor(initial: SleekPolicyConfig, filePath?: string) {
    this.current = initial;
    this.filePath = filePath;
  }

  public get(): SleekPolicyConfig {
    return this.current;
  }

  public async reload(): Promise<SleekPolicyConfig> {
    if (this.filePath === undefined) {
      return this.current;
    }
    const next = await loadSleekConfig(this.filePath);
    this.current = next;
    for (const listener of this.listeners) {
      listener(next);
    }
    return next;
  }

  public updateInMemory(next: SleekPolicyConfig): void {
    this.current = next;
    for (const listener of this.listeners) {
      listener(next);
    }
  }

  public onDidReload(listener: (next: SleekPolicyConfig) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
