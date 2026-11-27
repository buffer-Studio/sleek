import {AuthorityLevel} from '../auth/authorityLevel';

export interface VelocityCheckConfig {
  readonly burstLimit: number;
  readonly burstWindowSeconds: number;
  readonly sustainedLimit?: number;
  readonly sustainedWindowSeconds?: number;
}

export interface VelocityEvaluationResult {
  readonly tripped: boolean;
  readonly windowKind: 'burst' | 'sustained' | undefined;
  readonly count: number;
  readonly limit: number;
}

export function buildVelocityKey(
  platform: string,
  guildId: string,
  actorId: string,
  windowKind: 'burst' | 'sustained',
): string {
  return `sleek:{${platform}:${guildId}}:vel:${actorId}:${windowKind}`;
}

export function checkVelocityCounts(options: {
  readonly actorLevel: AuthorityLevel;
  readonly burstCount: number;
  readonly sustainedCount: number;
  readonly config: VelocityCheckConfig;
  readonly isCompleteTrustActive: boolean;
}): VelocityEvaluationResult {
  if (options.actorLevel === AuthorityLevel.PlatformDeveloper) {
    return {tripped: false, windowKind: undefined, count: 0, limit: 0};
  }

  if (options.actorLevel === AuthorityLevel.ActingOwner && options.isCompleteTrustActive) {
    return {tripped: false, windowKind: undefined, count: 0, limit: 0};
  }

  if (options.burstCount > options.config.burstLimit) {
    return {
      tripped: true,
      windowKind: 'burst',
      count: options.burstCount,
      limit: options.config.burstLimit,
    };
  }

  if (
    options.config.sustainedLimit !== undefined &&
    options.sustainedCount > options.config.sustainedLimit
  ) {
    return {
      tripped: true,
      windowKind: 'sustained',
      count: options.sustainedCount,
      limit: options.config.sustainedLimit,
    };
  }

  return {tripped: false, windowKind: undefined, count: 0, limit: 0};
}
