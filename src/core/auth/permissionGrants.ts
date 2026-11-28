import {AuthorityLevel} from './authorityLevel';
import type {TargetImmunityInput, TargetImmunityResult} from './permissionTypes';
import {isSovereignNode} from './sovereignNodes';

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
