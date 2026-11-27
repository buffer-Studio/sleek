import {and, eq} from 'drizzle-orm';

import type {PlatformId} from '../../../base/common/platformId';
import type {DatabaseClient} from '../../../platform/database/drizzleClient';
import type {GovernanceStore, GuildGovernanceState} from '../governance.contract';
import {
  guildCommandAliases,
  guildDisabledCommands,
  guildDisabledModules,
  guildIgnoredTargets,
  guildSettings,
  userCommandAliases,
  userPersonalPrefixes,
} from '../schema/governance.table';

export function createPgGovernanceStore(client: DatabaseClient): GovernanceStore {
  const {db} = client;

  return {
    getGuildGovernanceState: async (
      platform: PlatformId,
      guildId: string,
    ): Promise<GuildGovernanceState> => {
      const [settingsRows, aliasRows, modRows, cmdRows, ignoreRows] = await Promise.all([
        db
          .select()
          .from(guildSettings)
          .where(and(eq(guildSettings.platform, platform), eq(guildSettings.guildId, guildId)))
          .limit(1),
        db
          .select()
          .from(guildCommandAliases)
          .where(
            and(
              eq(guildCommandAliases.platform, platform),
              eq(guildCommandAliases.guildId, guildId),
            ),
          ),
        db
          .select()
          .from(guildDisabledModules)
          .where(
            and(
              eq(guildDisabledModules.platform, platform),
              eq(guildDisabledModules.guildId, guildId),
            ),
          ),
        db
          .select()
          .from(guildDisabledCommands)
          .where(
            and(
              eq(guildDisabledCommands.platform, platform),
              eq(guildDisabledCommands.guildId, guildId),
            ),
          ),
        db
          .select()
          .from(guildIgnoredTargets)
          .where(
            and(
              eq(guildIgnoredTargets.platform, platform),
              eq(guildIgnoredTargets.guildId, guildId),
            ),
          ),
      ]);

      const settings = settingsRows[0];
      const guildAliases: Record<string, string> = {};
      for (const row of aliasRows) {
        guildAliases[row.shortcut] = row.targetCommand;
      }

      const disabledModules = new Set<string>();
      for (const row of modRows) {
        disabledModules.add(`${row.moduleId}:${row.scopeType}:${row.scopeId}`);
      }

      const disabledCommands = new Set<string>();
      for (const row of cmdRows) {
        disabledCommands.add(`${row.commandName}:${row.scopeType}:${row.scopeId}`);
      }

      const ignoredChannels = new Set<string>();
      const ignoredUsers = new Set<string>();
      for (const row of ignoreRows) {
        if (row.targetType === 'channel') {
          ignoredChannels.add(row.targetId);
        } else {
          ignoredUsers.add(row.targetId);
        }
      }

      return {
        prefix: settings?.prefix ?? ',',
        fallbackCommaDisabled: settings?.fallbackCommaDisabled ?? false,
        modlogChannelId: settings?.modlogChannelId ?? undefined,
        isFrozen: settings?.isFrozen ?? false,
        frozenReason: settings?.frozenReason ?? undefined,
        guildAliases,
        disabledModules,
        disabledCommands,
        ignoredChannels,
        ignoredUsers,
      };
    },

    setGuildPrefix: async options => {
      await db
        .insert(guildSettings)
        .values({
          platform: options.platform,
          guildId: options.guildId,
          prefix: options.prefix,
          fallbackCommaDisabled: options.fallbackCommaDisabled,
        })
        .onConflictDoUpdate({
          target: [guildSettings.platform, guildSettings.guildId],
          set: {
            prefix: options.prefix,
            fallbackCommaDisabled: options.fallbackCommaDisabled,
            updatedAt: new Date(),
          },
        });
    },

    resetGuildPrefix: async (platform, guildId) => {
      await db
        .insert(guildSettings)
        .values({
          platform,
          guildId,
          prefix: ',',
          fallbackCommaDisabled: false,
        })
        .onConflictDoUpdate({
          target: [guildSettings.platform, guildSettings.guildId],
          set: {prefix: ',', fallbackCommaDisabled: false, updatedAt: new Date()},
        });
    },

    setGuildFrozen: async options => {
      await db
        .insert(guildSettings)
        .values({
          platform: options.platform,
          guildId: options.guildId,
          isFrozen: options.frozen,
          frozenReason: options.reason,
        })
        .onConflictDoUpdate({
          target: [guildSettings.platform, guildSettings.guildId],
          set: {
            isFrozen: options.frozen,
            frozenReason: options.reason,
            updatedAt: new Date(),
          },
        });
    },

    getPersonalPrefix: async (platform, userId) => {
      const rows = await db
        .select({prefix: userPersonalPrefixes.prefix})
        .from(userPersonalPrefixes)
        .where(
          and(eq(userPersonalPrefixes.platform, platform), eq(userPersonalPrefixes.userId, userId)),
        )
        .limit(1);
      return rows[0]?.prefix;
    },

    setPersonalPrefix: async (platform, userId, prefix) => {
      await db
        .insert(userPersonalPrefixes)
        .values({platform, userId, prefix})
        .onConflictDoUpdate({
          target: [userPersonalPrefixes.platform, userPersonalPrefixes.userId],
          set: {prefix, updatedAt: new Date()},
        });
    },

    getUserAliases: async (platform, userId) => {
      const rows = await db
        .select()
        .from(userCommandAliases)
        .where(
          and(eq(userCommandAliases.platform, platform), eq(userCommandAliases.userId, userId)),
        );
      const out: Record<string, string> = {};
      for (const row of rows) {
        out[row.shortcut] = row.targetCommand;
      }
      return out;
    },

    upsertGuildAlias: async options => {
      await db
        .insert(guildCommandAliases)
        .values({
          platform: options.platform,
          guildId: options.guildId,
          shortcut: options.shortcut.toLowerCase(),
          targetCommand: options.targetCommand,
          createdBy: options.actorId,
        })
        .onConflictDoUpdate({
          target: [
            guildCommandAliases.platform,
            guildCommandAliases.guildId,
            guildCommandAliases.shortcut,
          ],
          set: {targetCommand: options.targetCommand, createdBy: options.actorId},
        });
    },

    removeGuildAlias: async (platform, guildId, shortcut) => {
      const deleted = await db
        .delete(guildCommandAliases)
        .where(
          and(
            eq(guildCommandAliases.platform, platform),
            eq(guildCommandAliases.guildId, guildId),
            eq(guildCommandAliases.shortcut, shortcut.toLowerCase()),
          ),
        )
        .returning({shortcut: guildCommandAliases.shortcut});
      return deleted.length > 0;
    },

    resetGuildAliases: async (platform, guildId) => {
      await db
        .delete(guildCommandAliases)
        .where(
          and(eq(guildCommandAliases.platform, platform), eq(guildCommandAliases.guildId, guildId)),
        );
    },

    upsertUserAlias: async options => {
      await db
        .insert(userCommandAliases)
        .values({
          platform: options.platform,
          userId: options.userId,
          shortcut: options.shortcut.toLowerCase(),
          targetCommand: options.targetCommand,
        })
        .onConflictDoUpdate({
          target: [
            userCommandAliases.platform,
            userCommandAliases.userId,
            userCommandAliases.shortcut,
          ],
          set: {targetCommand: options.targetCommand},
        });
    },

    setCommandDisabled: async options => {
      if (options.disabled) {
        await db
          .insert(guildDisabledCommands)
          .values({
            platform: options.platform,
            guildId: options.guildId,
            commandName: options.commandName.toLowerCase(),
            scopeType: options.scopeType,
            scopeId: options.scopeId,
            disabledBy: options.actorId,
          })
          .onConflictDoNothing();
      } else {
        await db
          .delete(guildDisabledCommands)
          .where(
            and(
              eq(guildDisabledCommands.platform, options.platform),
              eq(guildDisabledCommands.guildId, options.guildId),
              eq(guildDisabledCommands.commandName, options.commandName.toLowerCase()),
              eq(guildDisabledCommands.scopeType, options.scopeType),
              eq(guildDisabledCommands.scopeId, options.scopeId),
            ),
          );
      }
    },

    setModuleDisabled: async options => {
      if (options.disabled) {
        await db
          .insert(guildDisabledModules)
          .values({
            platform: options.platform,
            guildId: options.guildId,
            moduleId: options.moduleId.toLowerCase(),
            scopeType: options.scopeType,
            scopeId: options.scopeId,
            disabledBy: options.actorId,
          })
          .onConflictDoNothing();
      } else {
        await db
          .delete(guildDisabledModules)
          .where(
            and(
              eq(guildDisabledModules.platform, options.platform),
              eq(guildDisabledModules.guildId, options.guildId),
              eq(guildDisabledModules.moduleId, options.moduleId.toLowerCase()),
              eq(guildDisabledModules.scopeType, options.scopeType),
              eq(guildDisabledModules.scopeId, options.scopeId),
            ),
          );
      }
    },

    toggleIgnoredTarget: async options => {
      if (options.add) {
        await db
          .insert(guildIgnoredTargets)
          .values({
            platform: options.platform,
            guildId: options.guildId,
            targetType: options.targetType,
            targetId: options.targetId,
            addedBy: options.actorId,
          })
          .onConflictDoNothing();
      } else {
        await db
          .delete(guildIgnoredTargets)
          .where(
            and(
              eq(guildIgnoredTargets.platform, options.platform),
              eq(guildIgnoredTargets.guildId, options.guildId),
              eq(guildIgnoredTargets.targetType, options.targetType),
              eq(guildIgnoredTargets.targetId, options.targetId),
            ),
          );
      }
    },
  };
}
