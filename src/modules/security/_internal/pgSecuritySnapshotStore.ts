import {and, eq, inArray, sql} from 'drizzle-orm';

import type {PlatformId} from '../../../base/common/platformId';
import type {PermissionGrantRecord} from '../../../core/auth/permissionKernel';
import type {DatabaseClient} from '../../../platform/database/drizzleClient';
import {
  guildActingOwner,
  guildFakePermissions,
  guildPermissionEpochs,
  guildStaffRoles,
} from '../schema/security.table';
import type {ActingOwnerRecord, GuildSecuritySnapshot, SecurityStore} from '../security.contract';

export async function bumpEpochInDb(
  db: DatabaseClient['db'],
  platform: PlatformId,
  guildId: string,
): Promise<number> {
  const rows = await db
    .insert(guildPermissionEpochs)
    .values({platform, guildId, epoch: 2})
    .onConflictDoUpdate({
      target: [guildPermissionEpochs.platform, guildPermissionEpochs.guildId],
      set: {
        epoch: sql`${guildPermissionEpochs.epoch} + 1`,
        updatedAt: new Date(),
      },
    })
    .returning({epoch: guildPermissionEpochs.epoch});
  return rows[0]?.epoch ?? 1;
}

export function createPgSecuritySnapshotStore(
  db: DatabaseClient['db'],
): Pick<
  SecurityStore,
  | 'getGuildSecuritySnapshot'
  | 'getCurrentEpoch'
  | 'toggleStaffRole'
  | 'listStaffRoles'
  | 'addFakePermissions'
  | 'removeFakePermissions'
  | 'resetFakePermissions'
  | 'countGuildBindings'
> {
  return {
    getGuildSecuritySnapshot: async (
      platform: PlatformId,
      guildId: string,
    ): Promise<GuildSecuritySnapshot> => {
      const [epochRows, staffRows, aoRows, permRows] = await Promise.all([
        db
          .select({epoch: guildPermissionEpochs.epoch})
          .from(guildPermissionEpochs)
          .where(
            and(
              eq(guildPermissionEpochs.platform, platform),
              eq(guildPermissionEpochs.guildId, guildId),
            ),
          )
          .limit(1),
        db
          .select()
          .from(guildStaffRoles)
          .where(and(eq(guildStaffRoles.platform, platform), eq(guildStaffRoles.guildId, guildId))),
        db
          .select()
          .from(guildActingOwner)
          .where(
            and(eq(guildActingOwner.platform, platform), eq(guildActingOwner.guildId, guildId)),
          )
          .limit(1),
        db
          .select()
          .from(guildFakePermissions)
          .where(
            and(
              eq(guildFakePermissions.platform, platform),
              eq(guildFakePermissions.guildId, guildId),
            ),
          ),
      ]);

      const boundAdminRoleIds = new Set<string>();
      const boundStaffRoleIds = new Set<string>();
      for (const row of staffRows) {
        if (row.tier === 'admin') {
          boundAdminRoleIds.add(row.roleId);
        } else {
          boundStaffRoleIds.add(row.roleId);
        }
      }

      const aoRow = aoRows[0];
      const actingOwner: ActingOwnerRecord | undefined =
        aoRow !== undefined
          ? {
              platform: aoRow.platform,
              guildId: aoRow.guildId,
              userId: aoRow.userId,
              grantedNodes: aoRow.grantedNodes,
              leaseExpiresAtMs: aoRow.leaseExpiresAt?.getTime(),
              sessionId: aoRow.sessionId,
              burstLimit: aoRow.burstLimit,
              burstWindowSeconds: aoRow.burstWindowSeconds,
              sustainedLimit: aoRow.sustainedLimit,
              sustainedWindowSeconds: aoRow.sustainedWindowSeconds,
              isCompleteTrust: aoRow.isCompleteTrust,
              isRolling: aoRow.isRolling,
              trustExpiresAtMs: aoRow.trustExpiresAt?.getTime(),
              isFrozen: aoRow.isFrozen,
              addedBy: aoRow.addedBy,
            }
          : undefined;

      const grants: PermissionGrantRecord[] = permRows.map(row => ({
        targetId: row.targetId,
        isRole: row.isRole,
        node: row.node,
        expiresAtMs: row.expiresAt?.getTime(),
        channelScope: row.channelScope ?? undefined,
        approvalsRequired: row.approvalsRequired,
      }));

      return {
        epoch: epochRows[0]?.epoch ?? 1,
        boundAdminRoleIds,
        boundStaffRoleIds,
        actingOwner,
        grants,
      };
    },

    getCurrentEpoch: async (platform: PlatformId, guildId: string): Promise<number> => {
      const rows = await db
        .select({epoch: guildPermissionEpochs.epoch})
        .from(guildPermissionEpochs)
        .where(
          and(
            eq(guildPermissionEpochs.platform, platform),
            eq(guildPermissionEpochs.guildId, guildId),
          ),
        )
        .limit(1);
      return rows[0]?.epoch ?? 1;
    },

    toggleStaffRole: async options => {
      const existing = await db
        .select()
        .from(guildStaffRoles)
        .where(
          and(
            eq(guildStaffRoles.platform, options.platform),
            eq(guildStaffRoles.guildId, options.guildId),
            eq(guildStaffRoles.roleId, options.roleId),
          ),
        )
        .limit(1);

      let bound: boolean;
      if (existing[0]?.tier === options.tier) {
        await db
          .delete(guildStaffRoles)
          .where(
            and(
              eq(guildStaffRoles.platform, options.platform),
              eq(guildStaffRoles.guildId, options.guildId),
              eq(guildStaffRoles.roleId, options.roleId),
            ),
          );
        bound = false;
      } else {
        await db
          .insert(guildStaffRoles)
          .values({
            platform: options.platform,
            guildId: options.guildId,
            roleId: options.roleId,
            tier: options.tier,
            addedBy: options.actorId,
          })
          .onConflictDoUpdate({
            target: [guildStaffRoles.platform, guildStaffRoles.guildId, guildStaffRoles.roleId],
            set: {tier: options.tier, addedBy: options.actorId, addedAt: new Date()},
          });
        bound = true;
      }

      const epoch = await bumpEpochInDb(db, options.platform, options.guildId);
      return {bound, epoch};
    },

    listStaffRoles: async (platform: PlatformId, guildId: string, tier: 'staff' | 'admin') => {
      const rows = await db
        .select({roleId: guildStaffRoles.roleId})
        .from(guildStaffRoles)
        .where(
          and(
            eq(guildStaffRoles.platform, platform),
            eq(guildStaffRoles.guildId, guildId),
            eq(guildStaffRoles.tier, tier),
          ),
        );
      return rows.map(r => r.roleId);
    },

    addFakePermissions: async options => {
      for (const node of options.nodes) {
        await db
          .insert(guildFakePermissions)
          .values({
            platform: options.platform,
            guildId: options.guildId,
            targetId: options.targetId,
            isRole: options.isRole,
            node,
            expiresAt:
              options.expiresAtMs !== undefined ? new Date(options.expiresAtMs) : undefined,
            channelScope:
              options.channelScope !== undefined ? [...options.channelScope] : undefined,
            createdBy: options.actorId,
          })
          .onConflictDoUpdate({
            target: [
              guildFakePermissions.platform,
              guildFakePermissions.guildId,
              guildFakePermissions.targetId,
              guildFakePermissions.node,
            ],
            set: {
              expiresAt:
                options.expiresAtMs !== undefined ? new Date(options.expiresAtMs) : undefined,
              channelScope:
                options.channelScope !== undefined ? [...options.channelScope] : undefined,
              createdBy: options.actorId,
            },
          });
      }
      const epoch = await bumpEpochInDb(db, options.platform, options.guildId);
      return {epoch};
    },

    removeFakePermissions: async options => {
      if (options.nodes.length === 0) {
        const epoch = await bumpEpochInDb(db, options.platform, options.guildId);
        return {removed: 0, epoch};
      }
      const deleted = await db
        .delete(guildFakePermissions)
        .where(
          and(
            eq(guildFakePermissions.platform, options.platform),
            eq(guildFakePermissions.guildId, options.guildId),
            eq(guildFakePermissions.targetId, options.targetId),
            inArray(guildFakePermissions.node, [...options.nodes]),
          ),
        )
        .returning({node: guildFakePermissions.node});
      const epoch = await bumpEpochInDb(db, options.platform, options.guildId);
      return {removed: deleted.length, epoch};
    },

    resetFakePermissions: async options => {
      if (options.targetId === undefined) {
        await db
          .delete(guildFakePermissions)
          .where(
            and(
              eq(guildFakePermissions.platform, options.platform),
              eq(guildFakePermissions.guildId, options.guildId),
            ),
          );
      } else {
        await db
          .delete(guildFakePermissions)
          .where(
            and(
              eq(guildFakePermissions.platform, options.platform),
              eq(guildFakePermissions.guildId, options.guildId),
              eq(guildFakePermissions.targetId, options.targetId),
            ),
          );
      }
      const epoch = await bumpEpochInDb(db, options.platform, options.guildId);
      return {epoch};
    },

    countGuildBindings: async (platform: PlatformId, guildId: string): Promise<number> => {
      const rows = await db
        .select({count: sql<number>`count(*)::int`})
        .from(guildFakePermissions)
        .where(
          and(
            eq(guildFakePermissions.platform, platform),
            eq(guildFakePermissions.guildId, guildId),
          ),
        );
      return rows[0]?.count ?? 0;
    },
  };
}
