import {and, eq, sql} from 'drizzle-orm';

import type {PlatformId} from '../../../base/common/platformId';
import type {DatabaseClient} from '../../../platform/database/drizzleClient';
import type {HoneypotConfig, HoneypotStore, UpsertHoneypotConfigInput} from '../honeypot.contract';
import {guildHoneypotConfigs} from '../schema/honeypot.table';

function mapRow(row: typeof guildHoneypotConfigs.$inferSelect): HoneypotConfig {
  return {
    platform: row.platform,
    guildId: row.guildId,
    channelId: row.channelId,
    action: 'softban',
    deleteMessageSeconds: row.deleteMessageSeconds,
    customMessage: row.customMessage ?? undefined,
    dmMessage: row.dmMessage ?? undefined,
    warningMessageId: row.warningMessageId ?? undefined,
    counterMessageId: row.counterMessageId ?? undefined,
    logChannelId: row.logChannelId ?? undefined,
    detectionCount: row.detectionCount,
    enabled: row.enabled,
    updatedAtMs: row.updatedAt.getTime(),
  };
}

export function createPgHoneypotStore(client: DatabaseClient): HoneypotStore {
  const {db} = client;

  return {
    getConfig: async (platform: PlatformId, guildId: string) => {
      const rows = await db
        .select()
        .from(guildHoneypotConfigs)
        .where(
          and(
            eq(guildHoneypotConfigs.platform, platform),
            eq(guildHoneypotConfigs.guildId, guildId),
          ),
        )
        .limit(1);
      const row = rows[0];
      return row === undefined ? undefined : mapRow(row);
    },

    upsertConfig: async (input: UpsertHoneypotConfigInput) => {
      const rows = await db
        .insert(guildHoneypotConfigs)
        .values({
          platform: input.platform,
          guildId: input.guildId,
          channelId: input.channelId,
          action: input.action,
          deleteMessageSeconds: input.deleteMessageSeconds,
          customMessage: input.customMessage ?? null,
          dmMessage: input.dmMessage ?? null,
          warningMessageId: input.warningMessageId ?? null,
          counterMessageId: input.counterMessageId ?? null,
          logChannelId: input.logChannelId ?? null,
          enabled: input.enabled ?? true,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [guildHoneypotConfigs.platform, guildHoneypotConfigs.guildId],
          set: {
            channelId: input.channelId,
            action: input.action,
            deleteMessageSeconds: input.deleteMessageSeconds,
            customMessage: input.customMessage ?? null,
            dmMessage: input.dmMessage ?? null,
            enabled: input.enabled ?? true,
            updatedAt: new Date(),
          },
        })
        .returning();
      const row = rows[0];
      if (row === undefined) {
        throw new Error('Failed to upsert guild_honeypot_configs');
      }
      return mapRow(row);
    },

    updateWarningMessageId: async (platform, guildId, warningMessageId) => {
      await db
        .update(guildHoneypotConfigs)
        .set({warningMessageId, updatedAt: new Date()})
        .where(
          and(
            eq(guildHoneypotConfigs.platform, platform),
            eq(guildHoneypotConfigs.guildId, guildId),
          ),
        );
    },

    updateCounterMessageId: async (platform, guildId, counterMessageId) => {
      await db
        .update(guildHoneypotConfigs)
        .set({counterMessageId, updatedAt: new Date()})
        .where(
          and(
            eq(guildHoneypotConfigs.platform, platform),
            eq(guildHoneypotConfigs.guildId, guildId),
          ),
        );
    },

    updateCustomMessage: async (platform, guildId, customMessage) => {
      await db
        .update(guildHoneypotConfigs)
        .set({customMessage: customMessage ?? null, updatedAt: new Date()})
        .where(
          and(
            eq(guildHoneypotConfigs.platform, platform),
            eq(guildHoneypotConfigs.guildId, guildId),
          ),
        );
    },

    setLogChannelId: async (platform, guildId, logChannelId) => {
      const rows = await db
        .update(guildHoneypotConfigs)
        .set({logChannelId: logChannelId ?? null, updatedAt: new Date()})
        .where(
          and(
            eq(guildHoneypotConfigs.platform, platform),
            eq(guildHoneypotConfigs.guildId, guildId),
          ),
        )
        .returning({guildId: guildHoneypotConfigs.guildId});
      return rows.length > 0;
    },

    incrementDetectionCount: async (platform, guildId) => {
      const rows = await db
        .update(guildHoneypotConfigs)
        .set({
          detectionCount: sql`${guildHoneypotConfigs.detectionCount} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(guildHoneypotConfigs.platform, platform),
            eq(guildHoneypotConfigs.guildId, guildId),
          ),
        )
        .returning({detectionCount: guildHoneypotConfigs.detectionCount});
      return rows[0]?.detectionCount ?? 0;
    },

    deleteConfig: async (platform, guildId) => {
      const rows = await db
        .delete(guildHoneypotConfigs)
        .where(
          and(
            eq(guildHoneypotConfigs.platform, platform),
            eq(guildHoneypotConfigs.guildId, guildId),
          ),
        )
        .returning({guildId: guildHoneypotConfigs.guildId});
      return rows.length > 0;
    },
  };
}
