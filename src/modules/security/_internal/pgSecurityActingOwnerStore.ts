import {and, desc, eq, inArray} from 'drizzle-orm';

import type {PlatformId} from '../../../base/common/platformId';
import type {DatabaseClient} from '../../../platform/database/drizzleClient';
import {
  actingOwnerLedger,
  guildActingOwner,
  guildFakePermissions,
  platformAuditLogs,
  platformStaff,
} from '../schema/security.table';
import type {
  ActingOwnerLedgerRecord,
  ActingOwnerRecord,
  PlatformStaffRecord,
  SecurityStore,
} from '../security.contract';
import {bumpEpochInDb} from './pgSecuritySnapshotStore';

export function createPgSecurityActingOwnerStore(
  db: DatabaseClient['db'],
): Pick<
  SecurityStore,
  | 'setActingOwner'
  | 'revokeActingOwner'
  | 'setActingOwnerFrozen'
  | 'updateActingOwnerThresholds'
  | 'appendLedgerEntry'
  | 'getSessionLedger'
  | 'markLedgerRolledBack'
  | 'getPlatformStaff'
  | 'upsertPlatformStaff'
  | 'removePlatformStaff'
  | 'listPlatformStaff'
  | 'insertPlatformAuditLog'
  | 'uncompromiseMember'
> {
  return {
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
      const epoch = await bumpEpochInDb(db, record.platform, record.guildId);
      return {epoch};
    },

    revokeActingOwner: async (platform: PlatformId, guildId: string) => {
      await db
        .delete(guildActingOwner)
        .where(and(eq(guildActingOwner.platform, platform), eq(guildActingOwner.guildId, guildId)));
      const epoch = await bumpEpochInDb(db, platform, guildId);
      return {epoch};
    },

    setActingOwnerFrozen: async (platform: PlatformId, guildId: string, frozen: boolean) => {
      await db
        .update(guildActingOwner)
        .set({isFrozen: frozen})
        .where(and(eq(guildActingOwner.platform, platform), eq(guildActingOwner.guildId, guildId)));
      const epoch = await bumpEpochInDb(db, platform, guildId);
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
      const epoch = await bumpEpochInDb(db, options.platform, options.guildId);
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

      const epoch = await bumpEpochInDb(db, options.platform, options.guildId);
      return {actingOwnerRevoked: aoRows.length > 0, epoch};
    },
  };
}
