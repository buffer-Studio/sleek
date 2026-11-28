import type {AuthorityLevel, GlobalBotStaffTier} from './authorityLevel';

export interface PermissionGrantRecord {
  readonly targetId: string;
  readonly isRole: boolean;
  readonly node: string;
  readonly expiresAtMs?: number;
  readonly channelScope?: readonly string[];
  readonly approvalsRequired?: number;
}

export interface PermissionEvaluationInput {
  readonly guildId?: string;
  readonly channelId?: string;
  readonly isDm?: boolean;
  readonly moduleEnabled?: boolean;
  readonly commandNode: string;
  readonly actorId: string;
  readonly actorIsBotOwner: boolean;
  readonly actorBotStaffTier: GlobalBotStaffTier;
  readonly actorBotStaffNodes: readonly string[];
  readonly guildOwnerId?: string;
  readonly actingOwnerUserId?: string;
  readonly actingOwnerFrozen?: boolean;
  readonly actorRoleIds: readonly string[];
  readonly boundAdminRoleIds: ReadonlySet<string>;
  readonly boundStaffRoleIds: ReadonlySet<string>;
  readonly grants: readonly PermissionGrantRecord[];
  readonly ownershipSatisfied?: boolean;
  readonly configEpoch?: number;
  readonly storeAvailable: boolean;
  readonly requestedDurationMs?: number;
  readonly requestedCount?: number;
  readonly nowMs?: number;
}

export interface ExplainTraceLine {
  readonly stage: number;
  readonly label: string;
  readonly detail: string;
}

export interface PermissionDecision {
  readonly allowed: boolean;
  readonly stage: number;
  readonly reason: string;
  readonly actorLevel: AuthorityLevel;
  readonly epoch: number | undefined;
  readonly durationCeilingMs: number | undefined;
  readonly quantityCeiling: number | undefined;
  readonly trace: readonly ExplainTraceLine[];
}

export interface TargetImmunityInput {
  readonly actorLevel: AuthorityLevel;
  readonly targetLevel: AuthorityLevel;
  readonly actorHighestRolePosition?: number;
  readonly targetHighestRolePosition?: number;
  readonly botHighestRolePosition?: number;
  readonly allowDeveloperOverrideTrueOwner: boolean;
}

export interface TargetImmunityResult {
  readonly allowed: boolean;
  readonly reason: string;
}

export function denyDecision(
  stage: number,
  reason: string,
  actorLevel: AuthorityLevel,
  epoch: number | undefined,
  trace: readonly ExplainTraceLine[],
): PermissionDecision {
  return {
    allowed: false,
    stage,
    reason,
    actorLevel,
    epoch,
    durationCeilingMs: undefined,
    quantityCeiling: undefined,
    trace,
  };
}
