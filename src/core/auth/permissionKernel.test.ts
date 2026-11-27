import {describe, expect, it} from 'bun:test';

import {AuthorityLevel, GlobalBotStaffTier} from './authorityLevel';
import {
  canGrantNode,
  canModerateTarget,
  evaluatePermission,
  type PermissionEvaluationInput,
} from './permissionKernel';
import {normalizeGrantNodeInput} from './sovereignNodes';

function baseInput(overrides: Partial<PermissionEvaluationInput> = {}): PermissionEvaluationInput {
  return {
    guildId: '100000000000000001',
    channelId: '200000000000000001',
    isDm: false,
    moduleEnabled: true,
    commandNode: 'moderation.ban',
    actorId: '300000000000000001',
    actorIsBotOwner: false,
    actorBotStaffTier: GlobalBotStaffTier.None,
    actorBotStaffNodes: [],
    guildOwnerId: '900000000000000001',
    actingOwnerUserId: undefined,
    actingOwnerFrozen: false,
    actorRoleIds: ['400000000000000001'],
    boundAdminRoleIds: new Set(),
    boundStaffRoleIds: new Set(['400000000000000001']),
    grants: [],
    configEpoch: 1,
    storeAvailable: true,
    nowMs: 1_700_000_000_000,
    ...overrides,
  };
}

describe('permissionKernel', () => {
  it('enforces I4 deny-by-default and I5 tier-is-not-a-grant', () => {
    const decision = evaluatePermission(
      baseInput({
        boundAdminRoleIds: new Set(['400000000000000001']),
        grants: [],
      }),
    );
    expect(decision.allowed).toBe(false);
    expect(decision.stage).toBe(8);
  });

  it('enforces I2 deny dominance regardless of role order', () => {
    const decisionA = evaluatePermission(
      baseInput({
        actorRoleIds: ['roleA', 'roleB'],
        boundStaffRoleIds: new Set(['roleA']),
        grants: [
          {targetId: 'roleA', isRole: true, node: 'moderation.ban.*'},
          {targetId: 'roleB', isRole: true, node: '-moderation.ban'},
        ],
      }),
    );
    const decisionB = evaluatePermission(
      baseInput({
        actorRoleIds: ['roleB', 'roleA'],
        boundStaffRoleIds: new Set(['roleA']),
        grants: [
          {targetId: 'roleB', isRole: true, node: '-moderation.ban'},
          {targetId: 'roleA', isRole: true, node: 'moderation.ban.*'},
        ],
      }),
    );

    expect(decisionA.allowed).toBe(false);
    expect(decisionB.allowed).toBe(false);
  });

  it('enforces I3 strictest ceiling wins and C4 rejects omitted duration', () => {
    const noDuration = evaluatePermission(
      baseInput({
        commandNode: 'moderation.timeout.apply',
        actorRoleIds: ['r1', 'r2'],
        boundStaffRoleIds: new Set(['r1']),
        grants: [
          {targetId: 'r1', isRole: true, node: 'moderation.timeout.apply'},
          {targetId: 'r1', isRole: true, node: 'moderation.timeout.max.7d'},
          {targetId: 'r2', isRole: true, node: 'moderation.timeout.max.2h'},
        ],
      }),
    );
    expect(noDuration.allowed).toBe(false);
    expect(noDuration.reason).toContain('Duration required');

    const overCeiling = evaluatePermission(
      baseInput({
        commandNode: 'moderation.timeout.apply',
        actorRoleIds: ['r1', 'r2'],
        boundStaffRoleIds: new Set(['r1']),
        grants: [
          {targetId: 'r1', isRole: true, node: 'moderation.timeout.apply'},
          {targetId: 'r1', isRole: true, node: 'moderation.timeout.max.7d'},
          {targetId: 'r2', isRole: true, node: 'moderation.timeout.max.2h'},
        ],
        requestedDurationMs: 3 * 3_600_000,
      }),
    );
    expect(overCeiling.allowed).toBe(false);

    const withinCeiling = evaluatePermission(
      baseInput({
        commandNode: 'moderation.timeout.apply',
        actorRoleIds: ['r1', 'r2'],
        boundStaffRoleIds: new Set(['r1']),
        grants: [
          {targetId: 'r1', isRole: true, node: 'moderation.timeout.apply'},
          {targetId: 'r1', isRole: true, node: 'moderation.timeout.max.7d'},
          {targetId: 'r2', isRole: true, node: 'moderation.timeout.max.2h'},
        ],
        requestedDurationMs: 3_600_000,
      }),
    );
    expect(withinCeiling.allowed).toBe(true);
    expect(withinCeiling.durationCeilingMs).toBe(2 * 3_600_000);
  });

  it('enforces I7 sovereign nodes never expand via wildcards', () => {
    const viaWildcard = evaluatePermission(
      baseInput({
        commandNode: 'moderation.ban.all',
        boundAdminRoleIds: new Set(['400000000000000001']),
        grants: [{targetId: '400000000000000001', isRole: true, node: '*'}],
      }),
    );
    expect(viaWildcard.allowed).toBe(false);

    const viaExactL4 = evaluatePermission(
      baseInput({
        commandNode: 'moderation.ban.all',
        actorId: '900000000000000001',
      }),
    );
    expect(viaExactL4.allowed).toBe(true);
  });

  it('enforces I6 bot.* routing for L5 and Global Bot Staff S1-S3', () => {
    const l4Denied = evaluatePermission(
      baseInput({
        commandNode: 'bot.guilds.freeze',
        actorId: '900000000000000001',
      }),
    );
    expect(l4Denied.allowed).toBe(false);

    const s1DeniedFreeze = evaluatePermission(
      baseInput({
        commandNode: 'bot.guilds.freeze',
        actorBotStaffTier: GlobalBotStaffTier.Support,
      }),
    );
    expect(s1DeniedFreeze.allowed).toBe(false);

    const s2AllowedFreeze = evaluatePermission(
      baseInput({
        commandNode: 'bot.guilds.freeze',
        actorBotStaffTier: GlobalBotStaffTier.TrustAndSafety,
      }),
    );
    expect(s2AllowedFreeze.allowed).toBe(true);

    const l5AllowedSudo = evaluatePermission(
      baseInput({
        commandNode: 'bot.sudo.exec',
        actorIsBotOwner: true,
      }),
    );
    expect(l5AllowedSudo.allowed).toBe(true);
  });

  it('enforces I8 fail-closed on missing store or unknown node and I12 ownership predicates', () => {
    const noStore = evaluatePermission(baseInput({storeAvailable: false}));
    expect(noStore.allowed).toBe(false);

    const unknownNode = evaluatePermission(baseInput({commandNode: 'nonexistent.node'}));
    expect(unknownNode.allowed).toBe(false);
    expect(unknownNode.stage).toBe(2);

    const ownerDenied = evaluatePermission(
      baseInput({
        commandNode: 'voicemaster.channel.lock',
        ownershipSatisfied: false,
      }),
    );
    expect(ownerDenied.allowed).toBe(false);

    const ownerAllowed = evaluatePermission(
      baseInput({
        commandNode: 'voicemaster.channel.lock',
        ownershipSatisfied: true,
      }),
    );
    expect(ownerAllowed.allowed).toBe(true);
  });

  it('enforces I1/I11 grant ladder and L5 > L4 in-bot target moderation', () => {
    expect(
      canGrantNode({
        actorLevel: AuthorityLevel.BoundAdmin,
        targetLevel: AuthorityLevel.BoundAdmin,
        isSelfGrant: false,
        node: 'moderation.ban',
        actorHoldsNode: true,
      }).allowed,
    ).toBe(false);

    expect(
      canGrantNode({
        actorLevel: AuthorityLevel.BoundAdmin,
        targetLevel: AuthorityLevel.BoundStaff,
        isSelfGrant: false,
        node: 'moderation.ban',
        actorHoldsNode: false,
      }).allowed,
    ).toBe(false);

    expect(
      canModerateTarget({
        actorLevel: AuthorityLevel.ActingOwner,
        targetLevel: AuthorityLevel.TrueOwner,
        allowDeveloperOverrideTrueOwner: true,
      }).allowed,
    ).toBe(false);

    expect(
      canModerateTarget({
        actorLevel: AuthorityLevel.PlatformDeveloper,
        targetLevel: AuthorityLevel.TrueOwner,
        allowDeveloperOverrideTrueOwner: true,
      }).allowed,
    ).toBe(true);
  });

  it('normalizes legacy node aliases and rejects retired nodes', () => {
    const aliased = normalizeGrantNodeInput('bot.reload');
    expect(aliased.canonicalNode).toBe('bot.system.reload');
    expect(aliased.rewrittenFrom).toBe('bot.reload');

    expect(() => normalizeGrantNodeInput('antinuke.bypass')).toThrow('retired');
  });
});
