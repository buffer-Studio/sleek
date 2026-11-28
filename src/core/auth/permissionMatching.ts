import {AuthorityLevel} from './authorityLevel';
import {parseCeilingNode} from './ceilingParser';
import type {PermissionEvaluationInput, PermissionGrantRecord} from './permissionTypes';
import {isSovereignNode} from './sovereignNodes';

export function expandWildcardPrefixes(node: string): readonly string[] {
  const parts = node.split('.');
  const patterns: string[] = ['*'];
  for (let i = 1; i < parts.length; i += 1) {
    patterns.push(`${parts.slice(0, i).join('.')}.*`);
  }
  patterns.push(node);
  return patterns;
}

export function isGrantActiveInContext(
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

export function matchesNodeOrWildcard(grantedUnsigned: string, requestedNode: string): boolean {
  if (grantedUnsigned === requestedNode) {
    return true;
  }
  if (isSovereignNode(requestedNode)) {
    return false;
  }
  const patterns = expandWildcardPrefixes(requestedNode);
  return patterns.includes(grantedUnsigned);
}

export function matchesCeilingForNode(
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
