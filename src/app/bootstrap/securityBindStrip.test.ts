import {describe, expect, it} from 'bun:test';

import {dispatchPrefixMessage} from './commandDispatcher';
import {dispatchInteraction} from './interactionDispatcher';
import type {PlatformId} from '../../base/common/platformId';
import {createEventBus} from '../../core/events/eventBus';
import {createGuildHierarchyCache} from '../../core/hierarchy/guildHierarchyCache';
import {createFakeInteractionPort} from '../../core/ports/testing/fakeInteraction.port';
import {FakeMessagingPort} from '../../core/ports/testing/fakeMessaging.port';
import {FakeRolePort} from '../../core/ports/testing/fakeRole.port';
import {FakeValkeyClient} from '../../platform/cache/testing/fakeValkeyClient';
import {loadSleekConfig, SleekConfigStore} from '../../platform/config/sleekConfig';
import {TestServiceRegistry} from '../../platform/di/testServiceRegistry';
import {createStructuredLogger} from '../../platform/logger/structuredLogger';
import {
  GOVERNANCE_SERVICE_KEY,
  MemoryGovernanceStore,
} from '../../modules/governance/governance.contract';
import {registerCoreModules} from '../../modules/manifest';
import {
  MemorySecurityStore,
  SECURITY_SERVICE_KEY,
  SECURITY_SLASH_COMMANDS,
} from '../../modules/security/security.contract';

const GUILD_ID = '100000000000000001';
const CHANNEL_ID = '200000000000000001';
const OWNER_ID = '300000000000000001';
const ACTING_OWNER_ID = '300000000000000002';
const ADMIN_USER_ID = '300000000000000003';
const ADMIN_PEER_ID = '300000000000000004';
const STAFF_USER_ID = '300000000000000005';
const MEMBER_USER_ID = '300000000000000006';
const DISCORD_DEV_ID = '999999999999999999';
const FLUXER_DEV_ID = '888888888888888888';

const ADMIN_ROLE_ID = '500000000000000001';
const ADMIN_ROLE_2_ID = '500000000000000002';
const ADMIN_ROLE_3_ID = '500000000000000003';
const STAFF_ROLE_ID = '500000000000000010';
const STAFF_ROLE_2_ID = '500000000000000011';

async function setupHarness(options?: {readonly allowDevOverrideTrueOwner?: boolean}) {
  const registry = new TestServiceRegistry();
  const securityStore = new MemorySecurityStore();
  const governanceStore = new MemoryGovernanceStore();
  const valkey = new FakeValkeyClient();
  const basePolicy = await loadSleekConfig('config/sleek.yaml');
  const testPolicy = {
    ...basePolicy,
    cooldowns: {
      ...basePolicy.cooldowns,
      defaultMs: 0,
      burstMaxCount: 1000,
      severeAbuseThreshold: 2000,
      commandOverridesMs: {},
    },
    developer: {
      ...basePolicy.developer,
      allowOverrideTrueOwnerInBot: options?.allowDevOverrideTrueOwner ?? true,
    },
  };
  const configStore = new SleekConfigStore(testPolicy, 'config/sleek.yaml');
  const rolePort = new FakeRolePort();
  const messagingPort = new FakeMessagingPort();
  const interactionPort = createFakeInteractionPort();
  const logger = createStructuredLogger({minLevel: 'error', prettyConsole: false});
  const eventBus = createEventBus(logger);
  const hierarchyCache = createGuildHierarchyCache({
    eventBus,
    fetchGuildMetadata: () =>
      Promise.resolve({
        ownerId: OWNER_ID,
        roles: [],
      }),
  });

  const commandRegistry = registerCoreModules({
    registry,
    securityStore,
    governanceStore,
    valkey,
    database: undefined,
    configStore,
    botOwnersByPlatform: {
      discord: new Set([DISCORD_DEV_ID]),
      fluxer: new Set([FLUXER_DEV_ID]),
    },
    rolePort,
    messagingPort,
    interactionPort,
    eventBus,
    hierarchyCache,
    logger,
  });

  const security = registry.resolve(SECURITY_SERVICE_KEY);
  const governanceService = registry.resolve(GOVERNANCE_SERVICE_KEY);

  async function runPrefix(args: {
    readonly platform: PlatformId;
    readonly actorId: string;
    readonly actorRoleIds?: readonly string[];
    readonly guildId?: string | undefined;
    readonly content: string;
  }): Promise<readonly string[]> {
    const replies: string[] = [];
    await dispatchPrefixMessage(
      {commandRegistry, security, governance: governanceService, configStore},
      {
        platform: args.platform,
        guildId: 'guildId' in args ? args.guildId : GUILD_ID,
        channelId: CHANNEL_ID,
        actorId: args.actorId,
        actorRoleIds: args.actorRoleIds ?? [],
        guildOwnerId: OWNER_ID,
        content: args.content,
        reply: msg => {
          replies.push(msg);
          return Promise.resolve();
        },
      },
    );
    return replies;
  }

  async function runSlash(args: {
    readonly platform: PlatformId;
    readonly actorId: string;
    readonly actorRoleIds?: readonly string[];
    readonly guildId?: string | undefined;
    readonly name: string;
    readonly options?: readonly unknown[];
  }): Promise<{
    readonly handled: boolean;
    readonly replies: ReadonlyArray<{readonly content: string; readonly ephemeral?: boolean}>;
  }> {
    const before = interactionPort.replies.length;
    const handled = await dispatchInteraction(
      {
        commandRegistry,
        security,
        interactionPort,
        hierarchyCache,
      },
      args.platform,
      {
        id: `int-${before + 1}`,
        token: `tok-${before + 1}`,
        type: 2,
        guild_id: 'guildId' in args ? args.guildId : GUILD_ID,
        channel_id: CHANNEL_ID,
        member: {
          user: {id: args.actorId},
          roles: [...(args.actorRoleIds ?? [])],
        },
        data: {
          id: `cmd-${args.name}`,
          name: args.name,
          options: args.options ? [...args.options] : undefined,
        },
      },
    );
    const replies = interactionPort.replies.slice(before).map(r => ({
      content: r.content ?? '',
      ephemeral: r.ephemeral,
    }));
    return {handled, replies};
  }

  return {
    securityStore,
    rolePort,
    interactionPort,
    security,
    configStore,
    runPrefix,
    runSlash,
  };
}

describe('security bind & strip (discord + fluxer, prefix + slash)', () => {
  it('exports valid SECURITY_SLASH_COMMANDS definitions', () => {
    const names = SECURITY_SLASH_COMMANDS.map(c => c.name);
    expect(names).toEqual(['bind', 'stripadmin', 'stripstaff']);
    const bindCmd = SECURITY_SLASH_COMMANDS[0];
    expect(bindCmd.options.map(o => o.name)).toEqual(['admin', 'staff']);
  });

  for (const platform of ['discord', 'fluxer'] as const) {
    const devId = platform === 'discord' ? DISCORD_DEV_ID : FLUXER_DEV_ID;

    it(`[${platform}] enforces TrueOwner+ only for bind admin and stripadmin/strip admin`, async () => {
      const h = await setupHarness();

      // pre-bind staff & admin roles as TrueOwner
      await h.securityStore.toggleStaffRole({
        platform,
        guildId: GUILD_ID,
        roleId: ADMIN_ROLE_ID,
        tier: 'admin',
        actorId: OWNER_ID,
      });
      await h.securityStore.toggleStaffRole({
        platform,
        guildId: GUILD_ID,
        roleId: STAFF_ROLE_ID,
        tier: 'staff',
        actorId: OWNER_ID,
      });

      // appoint ActingOwner with wildcard grants (still L3 < TrueOwner L4!)
      await h.securityStore.setActingOwner({
        platform,
        guildId: GUILD_ID,
        userId: ACTING_OWNER_ID,
        grantedNodes: ['*', 'security.admin.bind', 'security.admin.strip'],
        leaseExpiresAtMs: undefined,
        sessionId: 'sess-1',
        burstLimit: 50,
        burstWindowSeconds: 60,
        sustainedLimit: 200,
        sustainedWindowSeconds: 3600,
        isCompleteTrust: true,
        isRolling: false,
        trustExpiresAtMs: undefined,
        isFrozen: false,
        addedBy: OWNER_ID,
      });

      // also grant fakeperms to BoundAdmin & BoundStaff to prove tier floor still blocks
      await h.securityStore.addFakePermissions({
        platform,
        guildId: GUILD_ID,
        targetId: ADMIN_ROLE_ID,
        isRole: true,
        nodes: ['security.admin.bind', 'security.admin.strip', '*'],
        expiresAtMs: undefined,
        channelScope: undefined,
        actorId: OWNER_ID,
      });
      await h.securityStore.addFakePermissions({
        platform,
        guildId: GUILD_ID,
        targetId: STAFF_ROLE_ID,
        isRole: true,
        nodes: ['security.admin.bind', 'security.admin.strip', '*'],
        expiresAtMs: undefined,
        channelScope: undefined,
        actorId: OWNER_ID,
      });
      await h.security.invalidateGuildCache(platform, GUILD_ID);

      const nonOwners: ReadonlyArray<{readonly id: string; readonly roles: readonly string[]}> = [
        {id: MEMBER_USER_ID, roles: []},
        {id: STAFF_USER_ID, roles: [STAFF_ROLE_ID]},
        {id: ADMIN_USER_ID, roles: [ADMIN_ROLE_ID]},
        {id: ACTING_OWNER_ID, roles: []},
      ];

      for (const actor of nonOwners) {
        for (const cmd of [
          `,bind admin <@&${ADMIN_ROLE_2_ID}>`,
          `,bindadmin <@&${ADMIN_ROLE_2_ID}>`,
          `,stripadmin <@${ADMIN_USER_ID}>`,
          `,strip admin <@${ADMIN_USER_ID}>`,
        ]) {
          const replies = await h.runPrefix({
            platform,
            actorId: actor.id,
            actorRoleIds: actor.roles,
            content: cmd,
          });
          expect(replies[0]).toContain('Permission denied');
        }
      }

      // TrueOwner (L4) succeeds for bind admin, bindadmin, stripadmin, strip admin
      const bindOk = await h.runPrefix({
        platform,
        actorId: OWNER_ID,
        content: `,bind admin <@&${ADMIN_ROLE_2_ID}>`,
      });
      expect(bindOk[0]).toContain(`Bound <@&${ADMIN_ROLE_2_ID}> as admin role`);

      const listOk = await h.runPrefix({
        platform,
        actorId: OWNER_ID,
        content: ',bindadmin list',
      });
      expect(listOk[0]).toContain(ADMIN_ROLE_ID);
      expect(listOk[0]).toContain(ADMIN_ROLE_2_ID);

      h.rolePort.setMemberRoles(platform, GUILD_ID, ADMIN_USER_ID, [ADMIN_ROLE_ID]);
      const stripOk = await h.runPrefix({
        platform,
        actorId: OWNER_ID,
        content: `,strip admin <@${ADMIN_USER_ID}> compromised`,
      });
      expect(stripOk[0]).toContain(`Stripped 1 bound admin role(s) from <@${ADMIN_USER_ID}>`);
      expect(h.rolePort.getStoredMemberRoles(platform, GUILD_ID, ADMIN_USER_ID)).toEqual([]);

      // PlatformDeveloper (L5) succeeds via ,sudo
      h.rolePort.setMemberRoles(platform, GUILD_ID, ADMIN_PEER_ID, [ADMIN_ROLE_2_ID]);
      const devStrip = await h.runPrefix({
        platform,
        actorId: devId,
        content: `,sudo ${GUILD_ID} stripadmin ${ADMIN_PEER_ID} audit`,
      });
      expect(devStrip[0]).toContain(`Stripped 1 bound admin role(s) from <@${ADMIN_PEER_ID}>`);
      expect(h.rolePort.mutations.at(-1)?.reason).toBe('audit');
    });

    it(`[${platform}] enforces BoundAdmin+ only for bind staff and stripstaff/strip staff`, async () => {
      const h = await setupHarness();

      await h.securityStore.toggleStaffRole({
        platform,
        guildId: GUILD_ID,
        roleId: ADMIN_ROLE_ID,
        tier: 'admin',
        actorId: OWNER_ID,
      });
      await h.securityStore.toggleStaffRole({
        platform,
        guildId: GUILD_ID,
        roleId: STAFF_ROLE_ID,
        tier: 'staff',
        actorId: OWNER_ID,
      });
      await h.securityStore.setActingOwner({
        platform,
        guildId: GUILD_ID,
        userId: ACTING_OWNER_ID,
        grantedNodes: [],
        leaseExpiresAtMs: undefined,
        sessionId: 'sess-2',
        burstLimit: 50,
        burstWindowSeconds: 60,
        sustainedLimit: 200,
        sustainedWindowSeconds: 3600,
        isCompleteTrust: true,
        isRolling: false,
        trustExpiresAtMs: undefined,
        isFrozen: false,
        addedBy: OWNER_ID,
      });

      // grant fakeperms to BoundStaff (L1) to prove L1 is still blocked by minTier=BoundAdmin
      await h.securityStore.addFakePermissions({
        platform,
        guildId: GUILD_ID,
        targetId: STAFF_ROLE_ID,
        isRole: true,
        nodes: ['security.staff.bind', 'security.staff.strip', '*'],
        expiresAtMs: undefined,
        channelScope: undefined,
        actorId: OWNER_ID,
      });
      await h.security.invalidateGuildCache(platform, GUILD_ID);

      for (const actor of [
        {id: MEMBER_USER_ID, roles: []},
        {id: STAFF_USER_ID, roles: [STAFF_ROLE_ID]},
      ]) {
        for (const cmd of [
          `,bind staff <@&${STAFF_ROLE_2_ID}>`,
          `,bindstaff <@&${STAFF_ROLE_2_ID}>`,
          `,stripstaff <@${STAFF_USER_ID}>`,
          `,strip staff <@${STAFF_USER_ID}>`,
        ]) {
          const replies = await h.runPrefix({
            platform,
            actorId: actor.id,
            actorRoleIds: actor.roles,
            content: cmd,
          });
          expect(replies[0]).toContain('Permission denied');
        }
      }

      // BoundAdmin (L2) succeeds WITHOUT needing any fakepermissions grant
      const bindStaffOk = await h.runPrefix({
        platform,
        actorId: ADMIN_USER_ID,
        actorRoleIds: [ADMIN_ROLE_ID],
        content: `,bind staff <@&${STAFF_ROLE_2_ID}>`,
      });
      expect(bindStaffOk[0]).toContain(`Bound <@&${STAFF_ROLE_2_ID}> as staff role`);

      const listStaffOk = await h.runPrefix({
        platform,
        actorId: ADMIN_USER_ID,
        actorRoleIds: [ADMIN_ROLE_ID],
        content: ',bindstaff list',
      });
      expect(listStaffOk[0]).toContain(STAFF_ROLE_ID);
      expect(listStaffOk[0]).toContain(STAFF_ROLE_2_ID);

      // BoundAdmin strips BoundStaff
      h.rolePort.setMemberRoles(platform, GUILD_ID, STAFF_USER_ID, [
        STAFF_ROLE_ID,
        STAFF_ROLE_2_ID,
      ]);
      const stripStaffOk = await h.runPrefix({
        platform,
        actorId: ADMIN_USER_ID,
        actorRoleIds: [ADMIN_ROLE_ID],
        content: `,strip staff <@${STAFF_USER_ID}> abuse`,
      });
      expect(stripStaffOk[0]).toContain(`Stripped 2 bound staff role(s) from <@${STAFF_USER_ID}>`);
      expect(h.rolePort.getStoredMemberRoles(platform, GUILD_ID, STAFF_USER_ID)).toEqual([]);

      // ActingOwner (L3) also succeeds without extra grants
      h.rolePort.setMemberRoles(platform, GUILD_ID, STAFF_USER_ID, [STAFF_ROLE_ID]);
      const aoStrip = await h.runPrefix({
        platform,
        actorId: ACTING_OWNER_ID,
        content: `,stripstaff ${STAFF_USER_ID}`,
      });
      expect(aoStrip[0]).toContain(`Stripped 1 bound staff role(s) from <@${STAFF_USER_ID}>`);

      // explicit negation on BoundAdmin blocks bind staff / stripstaff
      await h.securityStore.addFakePermissions({
        platform,
        guildId: GUILD_ID,
        targetId: ADMIN_ROLE_ID,
        isRole: true,
        nodes: ['-security.staff.bind', '-security.staff.strip'],
        expiresAtMs: undefined,
        channelScope: undefined,
        actorId: OWNER_ID,
      });
      await h.security.invalidateGuildCache(platform, GUILD_ID);

      const negatedBind = await h.runPrefix({
        platform,
        actorId: ADMIN_USER_ID,
        actorRoleIds: [ADMIN_ROLE_ID],
        content: `,bind staff <@&${STAFF_ROLE_2_ID}>`,
      });
      expect(negatedBind[0]).toContain('Permission denied');

      const negatedStrip = await h.runPrefix({
        platform,
        actorId: ADMIN_USER_ID,
        actorRoleIds: [ADMIN_ROLE_ID],
        content: `,stripstaff <@${STAFF_USER_ID}>`,
      });
      expect(negatedStrip[0]).toContain('Permission denied');
    });

    it(`[${platform}] enforces target immunity, maxBoundAdminsPerGuild, usage, DM denial, and error handling`, async () => {
      const h = await setupHarness({allowDevOverrideTrueOwner: false});

      await h.securityStore.toggleStaffRole({
        platform,
        guildId: GUILD_ID,
        roleId: ADMIN_ROLE_ID,
        tier: 'admin',
        actorId: OWNER_ID,
      });
      await h.securityStore.toggleStaffRole({
        platform,
        guildId: GUILD_ID,
        roleId: STAFF_ROLE_ID,
        tier: 'staff',
        actorId: OWNER_ID,
      });
      await h.security.invalidateGuildCache(platform, GUILD_ID);

      // peer immunity: BoundAdmin cannot stripstaff another BoundAdmin
      h.rolePort.setMemberRoles(platform, GUILD_ID, ADMIN_PEER_ID, [ADMIN_ROLE_ID, STAFF_ROLE_ID]);
      const peerStrip = await h.runPrefix({
        platform,
        actorId: ADMIN_USER_ID,
        actorRoleIds: [ADMIN_ROLE_ID],
        content: `,stripstaff <@${ADMIN_PEER_ID}>`,
      });
      expect(peerStrip[0]).toContain('Peer Immunity');
      expect(h.rolePort.getStoredMemberRoles(platform, GUILD_ID, ADMIN_PEER_ID)).toEqual([
        ADMIN_ROLE_ID,
        STAFF_ROLE_ID,
      ]);

      // TrueOwner immunity: TrueOwner cannot self-strip, and dev cannot strip TrueOwner when override is false
      const ownerSelfStrip = await h.runPrefix({
        platform,
        actorId: OWNER_ID,
        content: `,stripadmin <@${OWNER_ID}>`,
      });
      expect(ownerSelfStrip[0]).toContain('True Server Owner is untouchable');

      const devStripOwner = await h.runPrefix({
        platform,
        actorId: devId,
        content: `,stripadmin <@${OWNER_ID}>`,
      });
      expect(devStripOwner[0]).toContain('True Server Owner is untouchable');

      // maxBoundAdminsPerGuild (from config, e.g. 5)
      const maxAdmins = h.configStore.get().security.maxBoundAdminsPerGuild;
      for (let i = 2; i <= maxAdmins; i += 1) {
        const roleId = `50000000000000000${i}`;
        const okRes = await h.runPrefix({
          platform,
          actorId: OWNER_ID,
          content: `,bind admin ${roleId}`,
        });
        expect(okRes[0]).toContain(`Bound <@&${roleId}> as admin role`);
      }
      const overMaxRoleId = `50000000000000000${maxAdmins + 1}`;
      const overMax = await h.runPrefix({
        platform,
        actorId: OWNER_ID,
        content: `,bind admin ${overMaxRoleId}`,
      });
      expect(overMax[0]).toContain(`Maximum of ${maxAdmins} bound admin roles reached`);

      // toggle unbind works even when at max
      const unbindOk = await h.runPrefix({
        platform,
        actorId: OWNER_ID,
        content: `,bind admin ${ADMIN_ROLE_3_ID}`,
      });
      expect(unbindOk[0]).toContain(`Unbound <@&${ADMIN_ROLE_3_ID}> from admin roles`);

      // usage messages
      const bindUsage = await h.runPrefix({
        platform,
        actorId: OWNER_ID,
        content: ',bind admin not-a-role',
      });
      expect(bindUsage[0]).toContain('Usage:');

      const stripUsage = await h.runPrefix({
        platform,
        actorId: OWNER_ID,
        content: ',stripadmin',
      });
      expect(stripUsage[0]).toContain('Usage:');

      // DM context denied
      const dmDenied = await h.runPrefix({
        platform,
        actorId: OWNER_ID,
        guildId: undefined,
        content: `,bind admin ${ADMIN_ROLE_ID}`,
      });
      expect(dmDenied[0]).toContain('Permission denied');

      // REST / RolePort error does not report false success
      h.rolePort.setMemberRoles(platform, GUILD_ID, STAFF_USER_ID, [STAFF_ROLE_ID]);
      h.rolePort.failRemoveError = {code: 'missing_permissions', message: 'Missing Permissions'};
      const failStrip = await h.runPrefix({
        platform,
        actorId: OWNER_ID,
        content: `,stripstaff <@${STAFF_USER_ID}>`,
      });
      expect(failStrip[0]).toContain('Failed to strip staff roles');
      expect(failStrip[0]).toContain('Missing Permissions');
    });
  }

  it('[discord] supports /bind admin, /bind staff, /stripadmin, and /stripstaff slash commands', async () => {
    const h = await setupHarness();

    // non-owner cannot run /bind admin
    const deniedAdminBind = await h.runSlash({
      platform: 'discord',
      actorId: MEMBER_USER_ID,
      name: 'bind',
      options: [{type: 1, name: 'admin', options: [{type: 8, name: 'role', value: ADMIN_ROLE_ID}]}],
    });
    expect(deniedAdminBind.handled).toBe(true);
    expect(deniedAdminBind.replies[0]?.ephemeral).toBe(true);
    expect(deniedAdminBind.replies[0]?.content).toContain('Permission denied');

    // TrueOwner runs /bind admin
    const ownerAdminBind = await h.runSlash({
      platform: 'discord',
      actorId: OWNER_ID,
      name: 'bind',
      options: [{type: 1, name: 'admin', options: [{type: 8, name: 'role', value: ADMIN_ROLE_ID}]}],
    });
    expect(ownerAdminBind.replies[0]?.content).toContain(
      `Bound <@&${ADMIN_ROLE_ID}> as admin role`,
    );

    // TrueOwner runs /bind admin action:list
    const ownerAdminList = await h.runSlash({
      platform: 'discord',
      actorId: OWNER_ID,
      name: 'bind',
      options: [{type: 1, name: 'admin', options: [{type: 3, name: 'action', value: 'list'}]}],
    });
    expect(ownerAdminList.replies[0]?.content).toContain(`Bound admin roles: <@&${ADMIN_ROLE_ID}>`);

    // BoundAdmin runs /bind staff
    const adminStaffBind = await h.runSlash({
      platform: 'discord',
      actorId: ADMIN_USER_ID,
      actorRoleIds: [ADMIN_ROLE_ID],
      name: 'bind',
      options: [{type: 1, name: 'staff', options: [{type: 8, name: 'role', value: STAFF_ROLE_ID}]}],
    });
    expect(adminStaffBind.replies[0]?.content).toContain(
      `Bound <@&${STAFF_ROLE_ID}> as staff role`,
    );

    // BoundAdmin CANNOT run /stripadmin
    const adminStripAdminDenied = await h.runSlash({
      platform: 'discord',
      actorId: ADMIN_USER_ID,
      actorRoleIds: [ADMIN_ROLE_ID],
      name: 'stripadmin',
      options: [{type: 6, name: 'member', value: ADMIN_PEER_ID}],
    });
    expect(adminStripAdminDenied.replies[0]?.ephemeral).toBe(true);
    expect(adminStripAdminDenied.replies[0]?.content).toContain('Permission denied');

    // BoundAdmin CAN run /stripstaff against BoundStaff
    h.rolePort.setMemberRoles('discord', GUILD_ID, STAFF_USER_ID, [STAFF_ROLE_ID]);
    const adminStripStaff = await h.runSlash({
      platform: 'discord',
      actorId: ADMIN_USER_ID,
      actorRoleIds: [ADMIN_ROLE_ID],
      name: 'stripstaff',
      options: [
        {type: 6, name: 'member', value: STAFF_USER_ID},
        {type: 3, name: 'reason', value: 'slash cleanup'},
      ],
    });
    expect(adminStripStaff.replies[0]?.content).toContain(
      `Stripped 1 bound staff role(s) from <@${STAFF_USER_ID}>`,
    );
    expect(h.rolePort.mutations.at(-1)?.reason).toBe('slash cleanup');

    // TrueOwner runs /stripadmin
    h.rolePort.setMemberRoles('discord', GUILD_ID, ADMIN_USER_ID, [ADMIN_ROLE_ID]);
    const ownerStripAdmin = await h.runSlash({
      platform: 'discord',
      actorId: OWNER_ID,
      name: 'stripadmin',
      options: [{type: 6, name: 'member', value: ADMIN_USER_ID}],
    });
    expect(ownerStripAdmin.replies[0]?.content).toContain(
      `Stripped 1 bound admin role(s) from <@${ADMIN_USER_ID}>`,
    );
  });

  it('[fluxer] rejects INTERACTION_CREATE slash replies as unsupported_platform while prefix works', async () => {
    const h = await setupHarness();
    const res = await h.interactionPort.replyInteraction({
      platform: 'fluxer',
      interactionId: 'int-1',
      interactionToken: 'tok-1',
      content: 'test',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('unsupported_platform');
    }
  });
});
