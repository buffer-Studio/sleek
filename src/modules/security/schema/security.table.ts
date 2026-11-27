import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import type {PlatformId} from '../../../base/common/platformId';

export const guildStaffRoles = pgTable(
  'guild_staff_roles',
  {
    platform: text('platform').$type<PlatformId>().notNull(),
    guildId: text('guild_id').notNull(),
    roleId: text('role_id').notNull(),
    tier: text('tier').$type<'staff' | 'admin'>().notNull().default('staff'),
    addedAt: timestamp('added_at', {withTimezone: true}).notNull().defaultNow(),
    addedBy: text('added_by').notNull(),
  },
  table => [
    primaryKey({columns: [table.platform, table.guildId, table.roleId]}),
    index('idx_guild_staff_roles_tier').on(table.platform, table.guildId, table.tier),
  ],
);

export const guildActingOwner = pgTable(
  'guild_acting_owner',
  {
    platform: text('platform').$type<PlatformId>().notNull(),
    guildId: text('guild_id').notNull(),
    userId: text('user_id').notNull(),
    grantedNodes: text('granted_nodes').array().notNull().default(['*']),
    leaseExpiresAt: timestamp('lease_expires_at', {withTimezone: true}),
    sessionId: text('session_id').notNull(),
    burstLimit: integer('burst_limit').notNull().default(15),
    burstWindowSeconds: integer('burst_window_seconds').notNull().default(60),
    sustainedLimit: integer('sustained_limit').notNull().default(40),
    sustainedWindowSeconds: integer('sustained_window_seconds').notNull().default(3600),
    isCompleteTrust: boolean('is_complete_trust').notNull().default(false),
    isRolling: boolean('is_rolling').notNull().default(false),
    trustExpiresAt: timestamp('trust_expires_at', {withTimezone: true}),
    lastAttestedAt: timestamp('last_attested_at', {withTimezone: true}),
    isFrozen: boolean('is_frozen').notNull().default(false),
    addedAt: timestamp('added_at', {withTimezone: true}).notNull().defaultNow(),
    addedBy: text('added_by').notNull(),
  },
  table => [primaryKey({columns: [table.platform, table.guildId]})],
);

export const actingOwnerLedger = pgTable(
  'acting_owner_ledger',
  {
    platform: text('platform').$type<PlatformId>().notNull(),
    guildId: text('guild_id').notNull(),
    id: text('id').notNull(),
    sessionId: text('session_id').notNull(),
    actionType: text('action_type').notNull(),
    inverseAction: text('inverse_action'),
    targetId: text('target_id'),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    executedAt: timestamp('executed_at', {withTimezone: true}).notNull().defaultNow(),
    rolledBackAt: timestamp('rolled_back_at', {withTimezone: true}),
  },
  table => [
    primaryKey({columns: [table.platform, table.guildId, table.id]}),
    index('idx_acting_owner_ledger_session').on(table.platform, table.guildId, table.sessionId),
  ],
);

export const guildFakePermissions = pgTable(
  'guild_fake_permissions',
  {
    platform: text('platform').$type<PlatformId>().notNull(),
    guildId: text('guild_id').notNull(),
    targetId: text('target_id').notNull(),
    isRole: boolean('is_role').notNull().default(true),
    node: text('node').notNull(),
    expiresAt: timestamp('expires_at', {withTimezone: true}),
    channelScope: text('channel_scope').array(),
    approvalsRequired: smallint('approvals_required').notNull().default(0),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
    createdBy: text('created_by').notNull(),
  },
  table => [
    primaryKey({columns: [table.platform, table.guildId, table.targetId, table.node]}),
    index('idx_guild_fake_perms_lookup').on(table.platform, table.guildId, table.targetId),
  ],
);

export const guildPermissionEpochs = pgTable(
  'guild_permission_epochs',
  {
    platform: text('platform').$type<PlatformId>().notNull(),
    guildId: text('guild_id').notNull(),
    epoch: bigint('epoch', {mode: 'number'}).notNull().default(1),
    updatedAt: timestamp('updated_at', {withTimezone: true}).notNull().defaultNow(),
  },
  table => [primaryKey({columns: [table.platform, table.guildId]})],
);

// phase 2 hook table for operational shift quotas
export const guildRoleQuotas = pgTable(
  'guild_role_quotas',
  {
    platform: text('platform').$type<PlatformId>().notNull(),
    guildId: text('guild_id').notNull(),
    roleId: text('role_id').notNull(),
    actionNode: text('action_node').notNull(),
    limitCount: integer('limit_count').notNull(),
    windowSeconds: integer('window_seconds').notNull(),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
    createdBy: text('created_by').notNull(),
  },
  table => [primaryKey({columns: [table.platform, table.guildId, table.roleId, table.actionNode]})],
);

export const platformStaff = pgTable(
  'platform_staff',
  {
    platform: text('platform').$type<PlatformId>().notNull(),
    userId: text('user_id').notNull(),
    tier: text('tier').$type<'support' | 'tns' | 'admin' | 'developer'>().notNull(),
    grantedNodes: text('granted_nodes').array().notNull().default([]),
    addedAt: timestamp('added_at', {withTimezone: true}).notNull().defaultNow(),
    addedBy: text('added_by').notNull(),
  },
  table => [primaryKey({columns: [table.platform, table.userId]})],
);

export const platformAuditLogs = pgTable(
  'platform_audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    platform: text('platform').$type<PlatformId>().notNull(),
    executorId: text('executor_id').notNull(),
    targetGuildId: text('target_guild_id').notNull(),
    commandExecuted: text('command_executed').notNull(),
    reason: text('reason').notNull().default(''),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    executedAt: timestamp('executed_at', {withTimezone: true}).notNull().defaultNow(),
  },
  table => [
    index('idx_platform_audit_guild').on(table.platform, table.targetGuildId, table.executedAt),
  ],
);
