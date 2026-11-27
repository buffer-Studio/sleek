import {boolean, integer, pgTable, primaryKey, text, timestamp} from 'drizzle-orm/pg-core';

import type {PlatformId} from '../../../base/common/platformId';

export type HoneypotAction = 'softban';

export const guildHoneypotConfigs = pgTable(
  'guild_honeypot_configs',
  {
    platform: text('platform').$type<PlatformId>().notNull(),
    guildId: text('guild_id').notNull(),
    channelId: text('channel_id').notNull(),
    action: text('action').$type<HoneypotAction>().notNull().default('softban'),
    deleteMessageSeconds: integer('delete_message_seconds').notNull().default(604_800),
    customMessage: text('custom_message'),
    dmMessage: text('dm_message'),
    warningMessageId: text('warning_message_id'),
    counterMessageId: text('counter_message_id'),
    logChannelId: text('log_channel_id'),
    detectionCount: integer('detection_count').notNull().default(0),
    enabled: boolean('enabled').notNull().default(true),
    updatedAt: timestamp('updated_at', {withTimezone: true}).notNull().defaultNow(),
  },
  table => [primaryKey({columns: [table.platform, table.guildId]})],
);
