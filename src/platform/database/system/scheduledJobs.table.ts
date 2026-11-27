import {sql} from 'drizzle-orm';
import {
  bigserial,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export type ScheduledJobStatus = 'pending' | 'processing' | 'completed' | 'dead_letter';

export const scheduledJobs = pgTable(
  'scheduled_jobs',
  {
    id: bigserial('id', {mode: 'number'}).primaryKey(),
    jobType: text('job_type').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    status: text('status').$type<ScheduledJobStatus>().notNull().default('pending'),
    runAt: timestamp('run_at', {withTimezone: true}).notNull().defaultNow(),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    lockedBy: text('locked_by'),
    leaseExpiresAt: timestamp('lease_expires_at', {withTimezone: true}),
    dedupeKey: text('dedupe_key'),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', {withTimezone: true}).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', {withTimezone: true}).notNull().defaultNow(),
  },
  table => [
    index('idx_scheduled_jobs_pending_run_at')
      .on(table.runAt)
      .where(sql`${table.status} = 'pending'`),
    uniqueIndex('uidx_scheduled_jobs_active_dedupe')
      .on(table.dedupeKey)
      .where(sql`${table.status} IN ('pending', 'processing') AND ${table.dedupeKey} IS NOT NULL`),
  ],
);
