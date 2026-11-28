import type {PlatformId} from '../../../base/common/platformId';
import {AuthorityLevel, GlobalBotStaffTier} from '../../../core/auth/authorityLevel';
import {
  evaluatePermission,
  type PermissionDecision,
  resolveActorAuthorityLevel,
} from '../../../core/auth/permissionKernel';
import {buildVelocityKey, checkVelocityCounts} from '../../../core/ratelimit/velocityMath';
import type {SleekConfigStore} from '../../../platform/config/sleekConfig';
import type {StructuredLogger} from '../../../platform/logger/structuredLogger';
import type {
  ActingOwnerRecord,
  AuthorizeCommandInput,
  GuildSecuritySnapshot,
  SecurityStore,
} from '../security.contract';

export interface SecurityPolicyDeps {
  readonly store: SecurityStore;
  readonly configStore: SleekConfigStore;
  readonly logger: StructuredLogger;
  readonly localVelocity: Map<string, number[]>;
  readonly isBotOwner: (platform: PlatformId, userId: string) => boolean;
  readonly loadSnapshot: (
    platform: PlatformId,
    guildId: string,
  ) => Promise<GuildSecuritySnapshot | undefined>;
  readonly invalidateGuildCache: (platform: PlatformId, guildId: string) => Promise<void>;
}

function mapBotStaffTier(tier: string | undefined): GlobalBotStaffTier {
  switch (tier) {
    case 'developer':
      return GlobalBotStaffTier.Developer;
    case 'admin':
      return GlobalBotStaffTier.Admin;
    case 'tns':
      return GlobalBotStaffTier.TrustAndSafety;
    case 'support':
      return GlobalBotStaffTier.Support;
    default:
      return GlobalBotStaffTier.None;
  }
}

function generateSessionId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 8);
}

function activeActingOwnerId(
  ao: ActingOwnerRecord | undefined,
  nowMs: number,
): {
  readonly userId: string | undefined;
  readonly frozen: boolean;
} {
  if (ao === undefined) {
    return {userId: undefined, frozen: false};
  }
  if (ao.leaseExpiresAtMs !== undefined && ao.leaseExpiresAtMs <= nowMs) {
    return {userId: undefined, frozen: false};
  }
  return {userId: ao.userId, frozen: ao.isFrozen};
}

export async function resolveBotStaffTierPolicy(
  deps: SecurityPolicyDeps,
  platform: PlatformId,
  userId: string,
): Promise<{readonly tier: GlobalBotStaffTier; readonly nodes: readonly string[]}> {
  if (deps.isBotOwner(platform, userId)) {
    return {tier: GlobalBotStaffTier.Developer, nodes: ['bot.*']};
  }
  const staff = await deps.store.getPlatformStaff(platform, userId);
  if (staff === undefined) {
    return {tier: GlobalBotStaffTier.None, nodes: []};
  }
  return {tier: mapBotStaffTier(staff.tier), nodes: staff.grantedNodes};
}

export async function resolveActorLevelPolicy(
  deps: SecurityPolicyDeps,
  args: {
    readonly platform: PlatformId;
    readonly guildId: string;
    readonly userId: string;
    readonly guildOwnerId: string | undefined;
    readonly roleIds: readonly string[];
  },
): Promise<AuthorityLevel> {
  if (deps.isBotOwner(args.platform, args.userId)) {
    return AuthorityLevel.PlatformDeveloper;
  }
  const snapshot = await deps.loadSnapshot(args.platform, args.guildId);
  const nowMs = Date.now();
  const ao = activeActingOwnerId(snapshot?.actingOwner, nowMs);
  return resolveActorAuthorityLevel({
    actorId: args.userId,
    actorIsBotOwner: false,
    guildOwnerId: args.guildOwnerId,
    actingOwnerUserId: ao.userId,
    actingOwnerFrozen: ao.frozen,
    actorRoleIds: args.roleIds,
    boundAdminRoleIds: snapshot?.boundAdminRoleIds ?? new Set(),
    boundStaffRoleIds: snapshot?.boundStaffRoleIds ?? new Set(),
  });
}

export async function authorizeCommandPolicy(
  deps: SecurityPolicyDeps,
  input: AuthorizeCommandInput,
): Promise<PermissionDecision> {
  const botStaff = await resolveBotStaffTierPolicy(deps, input.platform, input.actorId);
  const botOwner = deps.isBotOwner(input.platform, input.actorId);
  const nowMs = Date.now();

  if (input.guildId === undefined) {
    return evaluatePermission({
      ...input,
      actorIsBotOwner: botOwner,
      actorBotStaffTier: botStaff.tier,
      actorBotStaffNodes: botStaff.nodes,
      boundAdminRoleIds: new Set(),
      boundStaffRoleIds: new Set(),
      grants: [],
      configEpoch: 1,
      storeAvailable: true,
      nowMs,
    });
  }

  const snapshot = await deps.loadSnapshot(input.platform, input.guildId);
  if (snapshot === undefined) {
    return evaluatePermission({
      ...input,
      actorIsBotOwner: botOwner,
      actorBotStaffTier: botStaff.tier,
      actorBotStaffNodes: botStaff.nodes,
      boundAdminRoleIds: new Set(),
      boundStaffRoleIds: new Set(),
      grants: [],
      configEpoch: undefined,
      storeAvailable: false,
      nowMs,
    });
  }

  const ao = activeActingOwnerId(snapshot.actingOwner, nowMs);
  const aoGrants =
    ao.userId !== undefined && !ao.frozen
      ? (snapshot.actingOwner?.grantedNodes.map(node => ({
          targetId: ao.userId ?? '',
          isRole: false,
          node,
        })) ?? [])
      : [];

  return evaluatePermission({
    ...input,
    actorIsBotOwner: botOwner,
    actorBotStaffTier: botStaff.tier,
    actorBotStaffNodes: botStaff.nodes,
    actingOwnerUserId: ao.userId,
    actingOwnerFrozen: ao.frozen,
    boundAdminRoleIds: snapshot.boundAdminRoleIds,
    boundStaffRoleIds: snapshot.boundStaffRoleIds,
    grants: [...snapshot.grants, ...aoGrants],
    configEpoch: snapshot.epoch,
    storeAvailable: true,
    nowMs,
  });
}

export async function recordStateChangeAndCheckVelocityPolicy(
  deps: SecurityPolicyDeps,
  args: {
    readonly platform: PlatformId;
    readonly guildId: string;
    readonly actorId: string;
    readonly actorLevel: AuthorityLevel;
    readonly actionType: string;
    readonly targetId?: string;
    readonly inverseAction?: string;
    readonly payload?: Readonly<Record<string, unknown>>;
  },
): Promise<{readonly tripped: boolean; readonly reason: string | undefined}> {
  if (args.actorLevel === AuthorityLevel.PlatformDeveloper) {
    return {tripped: false, reason: undefined};
  }

  const policy = deps.configStore.get();
  const snapshot = await deps.loadSnapshot(args.platform, args.guildId);
  const nowMs = Date.now();
  const ao = snapshot?.actingOwner;

  let velocityConfig = {
    burstLimit: policy.security.velocityTripwires.level1.limit,
    burstWindowSeconds: policy.security.velocityTripwires.level1.windowSeconds,
    sustainedLimit: undefined as number | undefined,
    sustainedWindowSeconds: undefined as number | undefined,
  };

  if (args.actorLevel === AuthorityLevel.BoundAdmin) {
    velocityConfig = {
      burstLimit: policy.security.velocityTripwires.level2.limit,
      burstWindowSeconds: policy.security.velocityTripwires.level2.windowSeconds,
      sustainedLimit: undefined,
      sustainedWindowSeconds: undefined,
    };
  } else if (args.actorLevel === AuthorityLevel.ActingOwner && ao !== undefined) {
    velocityConfig = {
      burstLimit: ao.burstLimit,
      burstWindowSeconds: ao.burstWindowSeconds,
      sustainedLimit: ao.sustainedLimit,
      sustainedWindowSeconds: ao.sustainedWindowSeconds,
    };
  } else if (args.actorLevel === AuthorityLevel.TrueOwner) {
    velocityConfig = {
      burstLimit: policy.security.velocityTripwires.level4.limit,
      burstWindowSeconds: policy.security.velocityTripwires.level4.windowSeconds,
      sustainedLimit: undefined,
      sustainedWindowSeconds: undefined,
    };
  }

  const burstKey = buildVelocityKey(args.platform, args.guildId, args.actorId, 'burst');
  const burstWindowMs = velocityConfig.burstWindowSeconds * 1000;
  const burstArr = (deps.localVelocity.get(burstKey) ?? []).filter(t => t > nowMs - burstWindowMs);
  burstArr.push(nowMs);
  deps.localVelocity.set(burstKey, burstArr);

  let sustainedCount = 0;
  if (velocityConfig.sustainedWindowSeconds !== undefined) {
    const sustainedKey = buildVelocityKey(args.platform, args.guildId, args.actorId, 'sustained');
    const sustainedWindowMs = velocityConfig.sustainedWindowSeconds * 1000;
    const sustainedArr = (deps.localVelocity.get(sustainedKey) ?? []).filter(
      t => t > nowMs - sustainedWindowMs,
    );
    sustainedArr.push(nowMs);
    deps.localVelocity.set(sustainedKey, sustainedArr);
    sustainedCount = sustainedArr.length;
  }

  const isCompleteTrustActive =
    ao?.userId === args.actorId &&
    ao.isCompleteTrust &&
    (ao.trustExpiresAtMs === undefined || ao.trustExpiresAtMs > nowMs);

  const check = checkVelocityCounts({
    actorLevel: args.actorLevel,
    burstCount: burstArr.length,
    sustainedCount,
    config: velocityConfig,
    isCompleteTrustActive,
  });

  if (check.tripped) {
    if (args.actorLevel === AuthorityLevel.ActingOwner) {
      await deps.store.setActingOwnerFrozen(args.platform, args.guildId, true);
      await deps.invalidateGuildCache(args.platform, args.guildId);
    }
    deps.logger.warn('security.velocity.tripped', {
      platform: args.platform,
      guildId: args.guildId,
      actorId: args.actorId,
      actorLevel: args.actorLevel,
      windowKind: check.windowKind,
      count: check.count,
      limit: check.limit,
    });
    return {
      tripped: true,
      reason: `Velocity tripwire tripped (${check.count}/${check.limit} in ${check.windowKind ?? 'burst'} window). Session frozen.`,
    };
  }

  if (args.actorLevel === AuthorityLevel.ActingOwner && ao !== undefined) {
    await deps.store.appendLedgerEntry({
      id: generateSessionId(),
      platform: args.platform,
      guildId: args.guildId,
      sessionId: ao.sessionId,
      actionType: args.actionType,
      inverseAction: args.inverseAction,
      targetId: args.targetId,
      payload: args.payload ?? {},
      executedAtMs: nowMs,
      rolledBackAtMs: undefined,
    });
  }

  return {tripped: false, reason: undefined};
}
