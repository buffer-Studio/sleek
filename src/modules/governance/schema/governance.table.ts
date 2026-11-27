import {
  boolean,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import type {PlatformId} from '../../../base/common/platformId';

export const guildSettings = pgTable(
  'guild_settings',
  {
    platform: text('platform').$type<PlatformId>().notNull(),
    guildId: text('guild_id').notNull(),
    prefix: text('prefix').notNull().default(','),
    fallbackCommaDisabled: boolean('fallback_comma_disabled').notNull().default(false),
    modlogChannelId: text('modlog_channel_id'),
    isFrozen: boolean('is_frozen').notNull().default(false),
    frozenReason: text('frozen_reason'),
    updatedAt: timestamp('updated_at', {withTimezone: true}).notNull().defaultNow(),
  },
  table => [primaryKey({columns: [table.platform, table.guildId]})],
);

export const guildCommandAliases = pgTable(
  'guild_command_aliases',
  {
    platform: text('platform').$type<PlatformId>().notNull(),
    guildId: text('guild_id').notNull(),
    shortcut: text('shortcut').notNull(),
    targetCommand: text('target_command').notNull(),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
    createdBy: text('created_by').notNull(),
  },
  table => [primaryKey({columns: [table.platform, table.guildId, table.shortcut]})],
);

export const userCommandAliases = pgTable(
  'user_command_aliases',
  {
    platform: text('platform').$type<PlatformId>().notNull(),
    userId: text('user_id').notNull(),
    shortcut: text('shortcut').notNull(),
    targetCommand: text('target_command').notNull(),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
  },
  table => [primaryKey({columns: [table.platform, table.userId, table.shortcut]})],
);

export const guildDisabledModules = pgTable(
  'guild_disabled_modules',
  {
    platform: text('platform').$type<PlatformId>().notNull(),
    guildId: text('guild_id').notNull(),
    moduleId: text('module_id').notNull(),
    scopeType: text('scope_type').$type<'guild' | 'channel' | 'role'>().notNull(),
    scopeId: text('scope_id').notNull(),
    disabledAt: timestamp('disabled_at', {withTimezone: true}).notNull().defaultNow(),
    disabledBy: text('disabled_by').notNull(),
  },
  table => [
    primaryKey({
      columns: [table.platform, table.guildId, table.moduleId, table.scopeType, table.scopeId],
    }),
  ],
);

export const guildDisabledCommands = pgTable(
  'guild_disabled_commands',
  {
    platform: text('platform').$type<PlatformId>().notNull(),
    guildId: text('guild_id').notNull(),
    commandName: text('command_name').notNull(),
    scopeType: text('scope_type').$type<'guild' | 'channel' | 'role' | 'user'>().notNull(),
    scopeId: text('scope_id').notNull(),
    disabledAt: timestamp('disabled_at', {withTimezone: true}).notNull().defaultNow(),
    disabledBy: text('disabled_by').notNull(),
  },
  table => [
    primaryKey({
      columns: [table.platform, table.guildId, table.commandName, table.scopeType, table.scopeId],
    }),
  ],
);

export const guildIgnoredTargets = pgTable(
  'guild_ignored_targets',
  {
    platform: text('platform').$type<PlatformId>().notNull(),
    guildId: text('guild_id').notNull(),
    targetType: text('target_type').$type<'channel' | 'user'>().notNull(),
    targetId: text('target_id').notNull(),
    addedAt: timestamp('added_at', {withTimezone: true}).notNull().defaultNow(),
    addedBy: text('added_by').notNull(),
  },
  table => [
    primaryKey({columns: [table.platform, table.guildId, table.targetType, table.targetId]}),
  ],
);

export const userPersonalPrefixes = pgTable(
  'user_personal_prefixes',
  {
    platform: text('platform').$type<PlatformId>().notNull(),
    userId: text('user_id').notNull(),
    prefix: text('prefix').notNull(),
    updatedAt: timestamp('updated_at', {withTimezone: true}).notNull().defaultNow(),
  },
  table => [primaryKey({columns: [table.platform, table.userId]})],
);

// phase 2 hook tables for top.gg vote tracking
export const botVoters = pgTable(
  'bot_voters',
  {
    platform: text('platform').$type<PlatformId>().notNull(),
    userId: text('user_id').notNull(),
    lastVotedAt: timestamp('last_voted_at', {withTimezone: true}).notNull().defaultNow(),
    voteExpiresAt: timestamp('vote_expires_at', {withTimezone: true}).notNull(),
    currentStreak: integer('current_streak').notNull().default(1),
    longestStreak: integer('longest_streak').notNull().default(1),
    totalVotes: integer('total_votes').notNull().default(1),
    isDonator: boolean('is_donator').notNull().default(false),
    donatorExpiresAt: timestamp('donator_expires_at', {withTimezone: true}),
  },
  table => [
    primaryKey({columns: [table.platform, table.userId]}),
    index('idx_bot_voters_expiry').on(table.platform, table.userId, table.voteExpiresAt),
  ],
);

export const topggVotes = pgTable(
  'topgg_votes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    platform: text('platform').$type<PlatformId>().notNull(),
    userId: text('user_id').notNull(),
    externalVoteId: text('external_vote_id').notNull(),
    voteType: text('vote_type').notNull(),
    isWeekend: boolean('is_weekend').notNull().default(false),
    receivedAt: timestamp('received_at', {withTimezone: true}).notNull().defaultNow(),
  },
  table => [
    uniqueIndex('uq_topgg_votes_idempotency').on(
      table.platform,
      table.userId,
      table.externalVoteId,
    ),
  ],
);
