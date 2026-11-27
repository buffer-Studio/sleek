import {AuthorityLevel, formatAuthorityLevel, GlobalBotStaffTier} from './authorityLevel';
import {parseCeilingNode} from './ceilingParser';
import {isRegisteredPermissionNode, PERMISSION_NODES} from './permissionNodeDictionary';
import {isSovereignNode} from './sovereignNodes';

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

function expandWildcardPrefixes(node: string): readonly string[] {
  const parts = node.split('.');
  const patterns: string[] = ['*'];
  for (let i = 1; i < parts.length; i += 1) {
    patterns.push(`${parts.slice(0, i).join('.')}.*`);
  }
  patterns.push(node);
  return patterns;
}

function isGrantActiveInContext(
  grant: PermissionGrantRecord,
  channelId: string | undefined,
  nowMs: number,
): boolean {
  if (grant.expiresAtMs !== undefined && grant.expiresAtMs <= nowMs) {
    return false;
  }
  if (grant.channelScope !== undefined && grant.channelScope.length > 0) {
    if (channelId === undefined || !grant.channelScope.includes(channelId)) {
      return false;
    }
  }
  return true;
}

function matchesNodeOrWildcard(grantedUnsigned: string, requestedNode: string): boolean {
  if (grantedUnsigned === requestedNode) {
    return true;
  }
  if (isSovereignNode(requestedNode)) {
    return false;
  }
  const patterns = expandWildcardPrefixes(requestedNode);
  return patterns.includes(grantedUnsigned);
}

function matchesCeilingForNode(
  grantedUnsigned: string,
  requestedNode: string,
): ReturnType<typeof parseCeilingNode> {
  const parsed = parseCeilingNode(grantedUnsigned);
  if (parsed === undefined) {
    return undefined;
  }
  if (requestedNode === parsed.baseNode || requestedNode.startsWith(`${parsed.baseNode}.`)) {
    return parsed;
  }
  return undefined;
}

export function resolveActorAuthorityLevel(
  input: Pick<
    PermissionEvaluationInput,
    | 'actorId'
    | 'actorIsBotOwner'
    | 'guildOwnerId'
    | 'actingOwnerUserId'
    | 'actingOwnerFrozen'
    | 'actorRoleIds'
    | 'boundAdminRoleIds'
    | 'boundStaffRoleIds'
  >,
): AuthorityLevel {
  if (input.actorIsBotOwner) {
    return AuthorityLevel.PlatformDeveloper;
  }
  if (input.guildOwnerId !== undefined && input.actorId === input.guildOwnerId) {
    return AuthorityLevel.TrueOwner;
  }
  if (
    input.actingOwnerUserId !== undefined &&
    input.actorId === input.actingOwnerUserId &&
    input.actingOwnerFrozen !== true
  ) {
    return AuthorityLevel.ActingOwner;
  }
  for (const roleId of input.actorRoleIds) {
    if (input.boundAdminRoleIds.has(roleId)) {
      return AuthorityLevel.BoundAdmin;
    }
  }
  for (const roleId of input.actorRoleIds) {
    if (input.boundStaffRoleIds.has(roleId)) {
      return AuthorityLevel.BoundStaff;
    }
  }
  return AuthorityLevel.Member;
}

function denyDecision(
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

export function evaluatePermission(input: PermissionEvaluationInput): PermissionDecision {
  const nowMs = input.nowMs ?? Date.now();
  const trace: ExplainTraceLine[] = [];
  const actorLevel = resolveActorAuthorityLevel(input);

  // stage 1: adapter gate
  if (input.isDm === true || input.guildId === undefined) {
    if (!input.commandNode.startsWith('bot.')) {
      trace.push({stage: 1, label: 'adapter', detail: 'DENY: guild context required'});
      return denyDecision(1, 'Guild context is required.', actorLevel, input.configEpoch, trace);
    }
  }
  if (input.moduleEnabled === false) {
    trace.push({stage: 1, label: 'adapter', detail: 'DENY: module disabled'});
    return denyDecision(
      1,
      'Module is disabled in this context.',
      actorLevel,
      input.configEpoch,
      trace,
    );
  }

  // stage 2: registry closure (I12)
  if (!isRegisteredPermissionNode(input.commandNode)) {
    trace.push({stage: 2, label: 'registry', detail: `DENY: unknown node ${input.commandNode}`});
    return denyDecision(
      2,
      `Unknown permission node '${input.commandNode}'.`,
      actorLevel,
      input.configEpoch,
      trace,
    );
  }
  const nodeMeta = PERMISSION_NODES[input.commandNode];
  trace.push({
    stage: 2,
    label: 'registry',
    detail: `registered (${nodeMeta.kind}, min=${formatAuthorityLevel(nodeMeta.minTier)}, sovereign=${String(nodeMeta.sovereign)})`,
  });

  // stage 3 & 4: store & epoch snapshot (I8, I9)
  if (!input.storeAvailable || input.configEpoch === undefined) {
    trace.push({stage: 4, label: 'epoch', detail: 'DENY: store or epoch unavailable'});
    return denyDecision(
      4,
      'Security store unavailable (fail-closed).',
      actorLevel,
      undefined,
      trace,
    );
  }
  trace.push({stage: 4, label: 'epoch', detail: `epoch=${input.configEpoch}`});

  // stage 5: level resolution
  trace.push({stage: 5, label: 'level', detail: formatAuthorityLevel(actorLevel)});

  // stage 6: global bot.* namespace & sovereign shortcut (I6)
  if (nodeMeta.scope === 'global' || input.commandNode.startsWith('bot.')) {
    if (actorLevel === AuthorityLevel.PlatformDeveloper) {
      trace.push({stage: 6, label: 'global', detail: 'ALLOW: Platform Developer (L5)'});
      return {
        allowed: true,
        stage: 6,
        reason: 'Platform Developer (L5)',
        actorLevel,
        epoch: input.configEpoch,
        durationCeilingMs: undefined,
        quantityCeiling: undefined,
        trace,
      };
    }
    const minBotTier = nodeMeta.minBotStaffTier ?? GlobalBotStaffTier.Developer;
    const hasStaffTier =
      input.actorBotStaffTier !== GlobalBotStaffTier.None && input.actorBotStaffTier >= minBotTier;
    const hasExplicitBotNode = input.actorBotStaffNodes.some(n =>
      matchesNodeOrWildcard(n, input.commandNode),
    );
    if (hasStaffTier || hasExplicitBotNode) {
      trace.push({
        stage: 6,
        label: 'global',
        detail: `ALLOW: Global Bot Staff (tier=${input.actorBotStaffTier})`,
      });
      return {
        allowed: true,
        stage: 6,
        reason: 'Global Bot Staff capability verified',
        actorLevel,
        epoch: input.configEpoch,
        durationCeilingMs: undefined,
        quantityCeiling: undefined,
        trace,
      };
    }
    trace.push({stage: 6, label: 'global', detail: 'DENY: bot.* requires L5 or Global Bot Staff'});
    return denyDecision(
      6,
      'Global platform capability requires Level 5 or authorized Global Bot Staff.',
      actorLevel,
      input.configEpoch,
      trace,
    );
  }

  if (actorLevel === AuthorityLevel.PlatformDeveloper) {
    trace.push({stage: 6, label: 'sovereign', detail: 'ALLOW: Platform Developer (L5)'});
    return {
      allowed: true,
      stage: 6,
      reason: 'Platform Developer (L5)',
      actorLevel,
      epoch: input.configEpoch,
      durationCeilingMs: undefined,
      quantityCeiling: undefined,
      trace,
    };
  }

  if (actorLevel === AuthorityLevel.TrueOwner) {
    trace.push({stage: 6, label: 'sovereign', detail: 'ALLOW: True Server Owner (L4)'});
    return {
      allowed: true,
      stage: 6,
      reason: 'True Server Owner (L4)',
      actorLevel,
      epoch: input.configEpoch,
      durationCeilingMs: undefined,
      quantityCeiling: undefined,
      trace,
    };
  }

  // stage 7: minimum tier floor (I5: floor only, never grants)
  if (actorLevel < nodeMeta.minTier) {
    trace.push({
      stage: 7,
      label: 'tier-floor',
      detail: `DENY: requires ${formatAuthorityLevel(nodeMeta.minTier)}`,
    });
    return denyDecision(
      7,
      `Requires at least ${formatAuthorityLevel(nodeMeta.minTier)}.`,
      actorLevel,
      input.configEpoch,
      trace,
    );
  }
  trace.push({stage: 7, label: 'tier-floor', detail: 'floor satisfied'});

  // stage 8: ownership predicate vs authority node (I2, I3, I4)
  if (nodeMeta.kind === 'ownership') {
    if (input.ownershipSatisfied === true) {
      trace.push({
        stage: 8,
        label: 'ownership',
        detail: 'ALLOW: live ownership predicate satisfied',
      });
      return {
        allowed: true,
        stage: 8,
        reason: 'Ownership predicate satisfied',
        actorLevel,
        epoch: input.configEpoch,
        durationCeilingMs: undefined,
        quantityCeiling: undefined,
        trace,
      };
    }
    trace.push({stage: 8, label: 'ownership', detail: 'DENY: actor does not own target resource'});
    return denyDecision(8, 'You do not own this resource.', actorLevel, input.configEpoch, trace);
  }

  const actorRoleSet = new Set(input.actorRoleIds);
  const relevantGrants = input.grants.filter(grant => {
    const targetMatches = grant.isRole
      ? actorRoleSet.has(grant.targetId)
      : grant.targetId === input.actorId;
    return targetMatches && isGrantActiveInContext(grant, input.channelId, nowMs);
  });

  // pass 1: deny dominance (I2) — user negations then role negations
  for (const grant of relevantGrants) {
    if (!grant.node.startsWith('-')) {
      continue;
    }
    const unsigned = grant.node.slice(1);
    if (matchesNodeOrWildcard(unsigned, input.commandNode)) {
      const sourceLabel = grant.isRole ? `role ${grant.targetId}` : 'user override';
      trace.push({stage: 8, label: 'deny-pass', detail: `DENY: ${grant.node} on ${sourceLabel}`});
      return denyDecision(
        8,
        `Explicit negation (${grant.node}) on ${sourceLabel}.`,
        actorLevel,
        input.configEpoch,
        trace,
      );
    }
  }

  // pass 2: allow search (I4, I7)
  let hasAllow = false;
  for (const grant of relevantGrants) {
    if (grant.node.startsWith('-')) {
      continue;
    }
    if (matchesNodeOrWildcard(grant.node, input.commandNode)) {
      hasAllow = true;
      trace.push({
        stage: 8,
        label: 'allow-pass',
        detail: `ALLOW via ${grant.node} (${grant.isRole ? `role ${grant.targetId}` : 'user'})`,
      });
    }
  }

  if (!hasAllow) {
    const isImplicitBoundAdminStaffGovernance =
      actorLevel >= AuthorityLevel.BoundAdmin &&
      (input.commandNode === 'security.staff.bind' || input.commandNode === 'security.staff.strip');
    if (isImplicitBoundAdminStaffGovernance) {
      trace.push({
        stage: 8,
        label: 'allow-pass',
        detail: `ALLOW via BoundAdmin+ floor for ${input.commandNode}`,
      });
    } else {
      trace.push({
        stage: 8,
        label: 'allow-pass',
        detail: `DENY: no grant for ${input.commandNode}`,
      });
      return denyDecision(
        8,
        `Missing permission node '${input.commandNode}'.`,
        actorLevel,
        input.configEpoch,
        trace,
      );
    }
  }

  // pass 3: strictest ceiling algebra (I3, c1-c5)
  let minDurationCeilingMs: number | undefined;
  let minQuantityCeiling: number | undefined;

  for (const grant of relevantGrants) {
    if (grant.node.startsWith('-')) {
      continue;
    }
    try {
      const ceiling = matchesCeilingForNode(grant.node, input.commandNode);
      if (ceiling === undefined) {
        continue;
      }
      if (ceiling.kind === 'duration') {
        minDurationCeilingMs =
          minDurationCeilingMs === undefined
            ? ceiling.value
            : Math.min(minDurationCeilingMs, ceiling.value);
      } else {
        minQuantityCeiling =
          minQuantityCeiling === undefined
            ? ceiling.value
            : Math.min(minQuantityCeiling, ceiling.value);
      }
    } catch {
      // I8 fail closed on unparseable ceiling
      trace.push({stage: 8, label: 'ceiling', detail: `DENY: invalid ceiling '${grant.node}'`});
      return denyDecision(
        8,
        `Invalid ceiling configuration '${grant.node}'.`,
        actorLevel,
        input.configEpoch,
        trace,
      );
    }
  }

  if (minDurationCeilingMs !== undefined) {
    if (input.requestedDurationMs === undefined) {
      trace.push({
        stage: 8,
        label: 'ceiling',
        detail: `DENY: duration required (max ${minDurationCeilingMs}ms)`,
      });
      return denyDecision(
        8,
        `Duration required (maximum allowed: ${minDurationCeilingMs}ms).`,
        actorLevel,
        input.configEpoch,
        trace,
      );
    }
    if (input.requestedDurationMs > minDurationCeilingMs) {
      trace.push({
        stage: 8,
        label: 'ceiling',
        detail: `DENY: requested duration ${input.requestedDurationMs}ms exceeds ${minDurationCeilingMs}ms`,
      });
      return denyDecision(
        8,
        `Requested duration exceeds ceiling (${minDurationCeilingMs}ms).`,
        actorLevel,
        input.configEpoch,
        trace,
      );
    }
  }

  if (minQuantityCeiling !== undefined && input.requestedCount !== undefined) {
    if (input.requestedCount > minQuantityCeiling) {
      trace.push({
        stage: 8,
        label: 'ceiling',
        detail: `DENY: requested count ${input.requestedCount} exceeds ${minQuantityCeiling}`,
      });
      return denyDecision(
        8,
        `Requested count (${input.requestedCount}) exceeds ceiling (${minQuantityCeiling}).`,
        actorLevel,
        input.configEpoch,
        trace,
      );
    }
  }

  return {
    allowed: true,
    stage: 12,
    reason: 'Authorized via fake permissions',
    actorLevel,
    epoch: input.configEpoch,
    durationCeilingMs: minDurationCeilingMs,
    quantityCeiling: minQuantityCeiling,
    trace,
  };
}

export function canGrantNode(options: {
  readonly actorLevel: AuthorityLevel;
  readonly targetLevel: AuthorityLevel;
  readonly isSelfGrant: boolean;
  readonly node: string;
  readonly actorHoldsNode: boolean;
}): {readonly allowed: boolean; readonly reason: string} {
  // I11: no self-arming or peer/upward grant
  if (options.isSelfGrant) {
    return {allowed: false, reason: 'Cannot grant permissions to yourself (I11).'};
  }
  if (options.actorLevel < AuthorityLevel.TrueOwner && options.targetLevel >= options.actorLevel) {
    return {
      allowed: false,
      reason: 'Target tier must be strictly lower than your authority level (I11).',
    };
  }

  // I6: namespace floor
  if (options.node.startsWith('bot.') && options.actorLevel < AuthorityLevel.PlatformDeveloper) {
    return {allowed: false, reason: 'bot.* nodes can only be granted by Level 5.'};
  }
  if (options.node.startsWith('security.') && options.actorLevel < AuthorityLevel.TrueOwner) {
    return {allowed: false, reason: 'security.* nodes require True Server Owner (L4) or L5.'};
  }

  // I7: sovereign tier
  if (isSovereignNode(options.node) && options.actorLevel < AuthorityLevel.TrueOwner) {
    return {allowed: false, reason: `Sovereign node '${options.node}' requires L4+ to grant.`};
  }

  // I1: attenuation (l4/l5 can grant anything within their scope; l2/l3 must hold the node)
  if (options.actorLevel < AuthorityLevel.TrueOwner && !options.actorHoldsNode) {
    return {
      allowed: false,
      reason: `Attenuation violation: you do not hold '${options.node}' (I1).`,
    };
  }

  return {allowed: true, reason: 'Grant permitted'};
}

export function canModerateTarget(input: TargetImmunityInput): TargetImmunityResult {
  if (
    input.targetLevel === AuthorityLevel.TrueOwner &&
    !(
      input.actorLevel === AuthorityLevel.PlatformDeveloper && input.allowDeveloperOverrideTrueOwner
    )
  ) {
    return {allowed: false, reason: 'Sovereign Invariant: True Server Owner is untouchable.'};
  }

  if (input.actorLevel !== AuthorityLevel.PlatformDeveloper) {
    if (input.actorLevel <= input.targetLevel) {
      return {
        allowed: false,
        reason: 'Peer Immunity: cannot moderate a member of equal or higher staff tier.',
      };
    }

    if (
      input.actorHighestRolePosition !== undefined &&
      input.targetHighestRolePosition !== undefined &&
      input.actorHighestRolePosition <= input.targetHighestRolePosition
    ) {
      return {
        allowed: false,
        reason: 'Hierarchy Violation: target highest role is equal to or above yours.',
      };
    }

    if (
      input.botHighestRolePosition !== undefined &&
      input.targetHighestRolePosition !== undefined &&
      input.botHighestRolePosition <= input.targetHighestRolePosition
    ) {
      return {
        allowed: false,
        reason: 'Feasibility Failure: target highest role is equal to or above the bot role.',
      };
    }
  }

  return {allowed: true, reason: 'Target immunity and hierarchy cleared.'};
}
