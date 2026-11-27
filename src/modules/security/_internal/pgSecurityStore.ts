import {and, desc, eq, inArray, sql} from 'drizzle-orm';

import type {PlatformId} from '../../../base/common/platformId';
import type {PermissionGrantRecord} from '../../../core/auth/permissionKernel';
import type {DatabaseClient} from '../../../platform/database/drizzleClient';
import {
  actingOwnerLedger,
  guildActingOwner,
  guildFakePermissions,
  guildPermissionEpochs,
  guildStaffRoles,
  platformAuditLogs,
  platformStaff,
} from '../schema/security.table';
import type {
  ActingOwnerLedgerRecord,
  ActingOwnerRecord,
  GuildSecuritySnapshot,
  PlatformStaffRecord,
  SecurityStore,
} from '../security.contract';

export function createPgSecurityStore(client: DatabaseClient): SecurityStore {
  const {db} = client;

  async function bumpEpochInDb(platform: PlatformId, guildId: string): Promise<number> {
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

      const epoch = await bumpEpochInDb(options.platform, options.guildId);
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
      const epoch = await bumpEpochInDb(options.platform, options.guildId);
      return {epoch};
    },

    removeFakePermissions: async options => {
      if (options.nodes.length === 0) {
        const epoch = await bumpEpochInDb(options.platform, options.guildId);
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
      const epoch = await bumpEpochInDb(options.platform, options.guildId);
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
      const epoch = await bumpEpochInDb(options.platform, options.guildId);
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

    setActingOwner: async (record: ActingOwnerRecord) => {
      await db
        .insert(guildActingOwner)
        .values({
          platform: record.platform,
          guildId: record.guildId,
          userId: record.userId,
          grantedNodes: [...record.grantedNodes],
          leaseExpiresAt:
            record.leaseExpiresAtMs !== undefined ? new Date(record.leaseExpiresAtMs) : undefined,
          sessionId: record.sessionId,
          burstLimit: record.burstLimit,
          burstWindowSeconds: record.burstWindowSeconds,
          sustainedLimit: record.sustainedLimit,
          sustainedWindowSeconds: record.sustainedWindowSeconds,
          isCompleteTrust: record.isCompleteTrust,
          isRolling: record.isRolling,
          trustExpiresAt:
            record.trustExpiresAtMs !== undefined ? new Date(record.trustExpiresAtMs) : undefined,
          isFrozen: record.isFrozen,
          addedBy: record.addedBy,
        })
        .onConflictDoUpdate({
          target: [guildActingOwner.platform, guildActingOwner.guildId],
          set: {
            userId: record.userId,
            grantedNodes: [...record.grantedNodes],
            leaseExpiresAt:
              record.leaseExpiresAtMs !== undefined ? new Date(record.leaseExpiresAtMs) : undefined,
            sessionId: record.sessionId,
            burstLimit: record.burstLimit,
            burstWindowSeconds: record.burstWindowSeconds,
            sustainedLimit: record.sustainedLimit,
            sustainedWindowSeconds: record.sustainedWindowSeconds,
            isCompleteTrust: record.isCompleteTrust,
            isRolling: record.isRolling,
            trustExpiresAt:
              record.trustExpiresAtMs !== undefined ? new Date(record.trustExpiresAtMs) : undefined,
            isFrozen: record.isFrozen,
            addedBy: record.addedBy,
            addedAt: new Date(),
          },
        });
      const epoch = await bumpEpochInDb(record.platform, record.guildId);
      return {epoch};
    },

    revokeActingOwner: async (platform: PlatformId, guildId: string) => {
      await db
        .delete(guildActingOwner)
        .where(and(eq(guildActingOwner.platform, platform), eq(guildActingOwner.guildId, guildId)));
      const epoch = await bumpEpochInDb(platform, guildId);
      return {epoch};
    },

    setActingOwnerFrozen: async (platform: PlatformId, guildId: string, frozen: boolean) => {
      await db
        .update(guildActingOwner)
        .set({isFrozen: frozen})
        .where(and(eq(guildActingOwner.platform, platform), eq(guildActingOwner.guildId, guildId)));
      const epoch = await bumpEpochInDb(platform, guildId);
      return {epoch};
    },

    updateActingOwnerThresholds: async options => {
      await db
        .update(guildActingOwner)
        .set({
          burstLimit: options.burstLimit,
          burstWindowSeconds: options.burstWindowSeconds,
          sustainedLimit: options.sustainedLimit,
          sustainedWindowSeconds: options.sustainedWindowSeconds,
        })
        .where(
          and(
            eq(guildActingOwner.platform, options.platform),
            eq(guildActingOwner.guildId, options.guildId),
          ),
        );
      const epoch = await bumpEpochInDb(options.platform, options.guildId);
      return {epoch};
    },

    appendLedgerEntry: async (entry: ActingOwnerLedgerRecord): Promise<void> => {
      await db.insert(actingOwnerLedger).values({
        platform: entry.platform,
        guildId: entry.guildId,
        id: entry.id,
        sessionId: entry.sessionId,
        actionType: entry.actionType,
        inverseAction: entry.inverseAction,
        targetId: entry.targetId,
        payload: {...entry.payload},
        executedAt: new Date(entry.executedAtMs),
        rolledBackAt:
          entry.rolledBackAtMs !== undefined ? new Date(entry.rolledBackAtMs) : undefined,
      });
    },

    getSessionLedger: async (platform: PlatformId, guildId: string, sessionId: string) => {
      const rows = await db
        .select()
        .from(actingOwnerLedger)
        .where(
          and(
            eq(actingOwnerLedger.platform, platform),
            eq(actingOwnerLedger.guildId, guildId),
            eq(actingOwnerLedger.sessionId, sessionId),
          ),
        )
        .orderBy(desc(actingOwnerLedger.executedAt));

      return rows.map(row => ({
        id: row.id,
        platform: row.platform,
        guildId: row.guildId,
        sessionId: row.sessionId,
        actionType: row.actionType,
        inverseAction: row.inverseAction ?? undefined,
        targetId: row.targetId ?? undefined,
        payload: row.payload,
        executedAtMs: row.executedAt.getTime(),
        rolledBackAtMs: row.rolledBackAt?.getTime(),
      }));
    },

    markLedgerRolledBack: async (
      platform: PlatformId,
      guildId: string,
      entryIds: readonly string[],
      rolledBackAtMs: number,
    ): Promise<void> => {
      if (entryIds.length === 0) {
        return;
      }
      await db
        .update(actingOwnerLedger)
        .set({rolledBackAt: new Date(rolledBackAtMs)})
        .where(
          and(
            eq(actingOwnerLedger.platform, platform),
            eq(actingOwnerLedger.guildId, guildId),
            inArray(actingOwnerLedger.id, [...entryIds]),
          ),
        );
    },

    getPlatformStaff: async (
      platform: PlatformId,
      userId: string,
    ): Promise<PlatformStaffRecord | undefined> => {
      const rows = await db
        .select()
        .from(platformStaff)
        .where(and(eq(platformStaff.platform, platform), eq(platformStaff.userId, userId)))
        .limit(1);
      const row = rows[0];
      if (row === undefined) {
        return undefined;
      }
      return {
        platform: row.platform,
        userId: row.userId,
        tier: row.tier,
        grantedNodes: row.grantedNodes,
        addedBy: row.addedBy,
      };
    },

    upsertPlatformStaff: async (record: PlatformStaffRecord): Promise<void> => {
      await db
        .insert(platformStaff)
        .values({
          platform: record.platform,
          userId: record.userId,
          tier: record.tier,
          grantedNodes: [...record.grantedNodes],
          addedBy: record.addedBy,
        })
        .onConflictDoUpdate({
          target: [platformStaff.platform, platformStaff.userId],
          set: {
            tier: record.tier,
            grantedNodes: [...record.grantedNodes],
            addedBy: record.addedBy,
            addedAt: new Date(),
          },
        });
    },

    removePlatformStaff: async (platform: PlatformId, userId: string): Promise<boolean> => {
      const deleted = await db
        .delete(platformStaff)
        .where(and(eq(platformStaff.platform, platform), eq(platformStaff.userId, userId)))
        .returning({userId: platformStaff.userId});
      return deleted.length > 0;
    },

    listPlatformStaff: async (platform: PlatformId): Promise<readonly PlatformStaffRecord[]> => {
      const rows = await db
        .select()
        .from(platformStaff)
        .where(eq(platformStaff.platform, platform));
      return rows.map(row => ({
        platform: row.platform,
        userId: row.userId,
        tier: row.tier,
        grantedNodes: row.grantedNodes,
        addedBy: row.addedBy,
      }));
    },

    insertPlatformAuditLog: async entry => {
      await db.insert(platformAuditLogs).values({
        platform: entry.platform,
        executorId: entry.executorId,
        targetGuildId: entry.targetGuildId,
        commandExecuted: entry.commandExecuted,
        reason: entry.reason,
        payload: {...entry.payload},
      });
    },

    uncompromiseMember: async options => {
      const aoRows = await db
        .delete(guildActingOwner)
        .where(
          and(
            eq(guildActingOwner.platform, options.platform),
            eq(guildActingOwner.guildId, options.guildId),
            eq(guildActingOwner.userId, options.targetUserId),
          ),
        )
        .returning({userId: guildActingOwner.userId});

      await db
        .delete(guildFakePermissions)
        .where(
          and(
            eq(guildFakePermissions.platform, options.platform),
            eq(guildFakePermissions.guildId, options.guildId),
            eq(guildFakePermissions.targetId, options.targetUserId),
            eq(guildFakePermissions.isRole, false),
          ),
        );

      const epoch = await bumpEpochInDb(options.platform, options.guildId);
      return {actingOwnerRevoked: aoRows.length > 0, epoch};
    },
  };
}
