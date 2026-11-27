import type {PlatformId} from '../../base/common/platformId';

export interface CooldownPolicy {
  readonly defaultMs: number;
  readonly burstMaxCount: number;
  readonly burstWindowMs: number;
  readonly floodLockMs: number;
  readonly severeAbuseThreshold: number;
  readonly countRejectedInBurst: boolean;
  readonly commandOverridesMs: Readonly<Record<string, number>>;
}

export type CooldownVerdict =
  | {readonly status: 'allow'}
  | {readonly status: 'bypass_developer'}
  | {readonly status: 'cooldown'; readonly retryAfterMs: number}
  | {readonly status: 'flood_locked'; readonly retryAfterMs: number}
  | {readonly status: 'silent_drop'};

export interface CooldownUserState {
  readonly lastCommandAtMs: Readonly<Record<string, number>>;
  readonly burstTimestampsMs: readonly number[];
  readonly lockedUntilMs: number;
  readonly violationCount: number;
}

export function createEmptyCooldownState(): CooldownUserState {
  return {
    lastCommandAtMs: {},
    burstTimestampsMs: [],
    lockedUntilMs: 0,
    violationCount: 0,
  };
}

export function buildCooldownKey(platform: PlatformId, guildId: string, userId: string): string {
  return `sleek:{${platform}:${guildId}}:cd:${userId}`;
}

export function evaluateCooldownState(options: {
  readonly state: CooldownUserState;
  readonly commandName: string;
  readonly policy: CooldownPolicy;
  readonly isDeveloper: boolean;
  readonly developerBypassEnabled: boolean;
  readonly nowMs: number;
}): {readonly verdict: CooldownVerdict; readonly nextState: CooldownUserState} {
  if (options.isDeveloper && options.developerBypassEnabled) {
    return {verdict: {status: 'bypass_developer'}, nextState: options.state};
  }

  const {state, policy, nowMs, commandName} = options;
  const windowCutoff = nowMs - policy.burstWindowMs;
  const recentBurst = state.burstTimestampsMs.filter(ts => ts > windowCutoff);

  if (state.lockedUntilMs > nowMs) {
    const nextViolations = state.violationCount + 1;
    const verdict: CooldownVerdict =
      nextViolations >= policy.severeAbuseThreshold
        ? {status: 'silent_drop'}
        : {status: 'flood_locked', retryAfterMs: state.lockedUntilMs - nowMs};
    return {
      verdict,
      nextState: {
        ...state,
        burstTimestampsMs: [...recentBurst, nowMs],
        violationCount: nextViolations,
      },
    };
  }

  const commandCooldownMs = policy.commandOverridesMs[commandName] ?? policy.defaultMs;
  const lastAt = state.lastCommandAtMs[commandName] ?? 0;
  const elapsed = nowMs - lastAt;

  if (commandCooldownMs > 0 && lastAt > 0 && elapsed < commandCooldownMs) {
    const nextBurst = policy.countRejectedInBurst ? [...recentBurst, nowMs] : recentBurst;
    const nextViolations = state.violationCount + 1;
    if (nextBurst.length >= policy.burstMaxCount) {
      return {
        verdict:
          nextViolations >= policy.severeAbuseThreshold
            ? {status: 'silent_drop'}
            : {status: 'flood_locked', retryAfterMs: policy.floodLockMs},
        nextState: {
          ...state,
          burstTimestampsMs: nextBurst,
          lockedUntilMs: nowMs + policy.floodLockMs,
          violationCount: nextViolations,
        },
      };
    }

    return {
      verdict:
        nextViolations >= policy.severeAbuseThreshold
          ? {status: 'silent_drop'}
          : {status: 'cooldown', retryAfterMs: commandCooldownMs - elapsed},
      nextState: {
        ...state,
        burstTimestampsMs: nextBurst,
        violationCount: nextViolations,
      },
    };
  }

  const nextBurst = [...recentBurst, nowMs];
  if (nextBurst.length > policy.burstMaxCount) {
    const nextViolations = state.violationCount + 1;
    return {
      verdict:
        nextViolations >= policy.severeAbuseThreshold
          ? {status: 'silent_drop'}
          : {status: 'flood_locked', retryAfterMs: policy.floodLockMs},
      nextState: {
        ...state,
        burstTimestampsMs: nextBurst,
        lockedUntilMs: nowMs + policy.floodLockMs,
        violationCount: nextViolations,
      },
    };
  }

  return {
    verdict: {status: 'allow'},
    nextState: {
      lastCommandAtMs: {
        ...state.lastCommandAtMs,
        [commandName]: nowMs,
      },
      burstTimestampsMs: nextBurst,
      lockedUntilMs: 0,
      violationCount: 0,
    },
  };
}
