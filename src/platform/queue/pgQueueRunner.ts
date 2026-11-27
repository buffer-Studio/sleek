import {and, asc, eq, inArray, lt, lte, sql} from 'drizzle-orm';

import type {AsyncDisposable} from '../../base/common/asyncDisposable';
import {type Disposable, toDisposable} from '../../base/common/disposable';
import {err, ok, type Result} from '../../base/common/result';
import type {ValkeyClient} from '../cache/valkeyClient';
import type {DatabaseClient} from '../database/drizzleClient';
import {scheduledJobs} from '../database/system/scheduledJobs.table';
import type {StructuredLogger} from '../logger/structuredLogger';
import type {
  EnqueueJobOptions,
  QueueJobContext,
  QueueJobHandler,
  QueuePort,
  QueuePortError,
} from './queue.port';

export const QUEUE_WAKE_CHANNEL = 'sleek:queue:wake';
const DEFAULT_POLL_INTERVAL_MS = 15_000;
const DEFAULT_LEASE_MS = 60_000;
const DEFAULT_BATCH_SIZE = 10;
const COMPLETED_RETENTION_DAYS = 7;

export interface PgQueueRunnerOptions {
  readonly database: DatabaseClient;
  readonly valkey?: ValkeyClient;
  readonly clusterId: string;
  readonly logger?: StructuredLogger;
  readonly pollIntervalMs?: number;
  readonly leaseMs?: number;
  readonly batchSize?: number;
  readonly nowMs?: () => number;
}

export interface PgQueueRunner extends QueuePort, AsyncDisposable {
  readonly start: () => Promise<void>;
  readonly pollOnce: () => Promise<number>;
}

interface ClaimedRow {
  readonly id: number;
  readonly jobType: string;
  readonly payload: Record<string, unknown>;
  readonly attempts: number;
  readonly maxAttempts: number;
}

function computeBackoffMs(attempts: number): number {
  const baseMs = Math.min(300_000, 1000 * 2 ** Math.max(0, attempts - 1));
  const jitter = Math.floor(Math.random() * Math.max(100, Math.floor(baseMs * 0.25)));
  return baseMs + jitter;
}

export function createPgQueueRunner(options: PgQueueRunnerOptions): PgQueueRunner {
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const leaseMs = Math.max(60_000, options.leaseMs ?? DEFAULT_LEASE_MS);
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const nowMs = options.nowMs ?? (() => Date.now());
  const handlers = new Map<string, QueueJobHandler>();
  const inflightExecutions = new Set<Promise<void>>();

  const runnerState = {
    started: false,
    stopping: false,
    isPolling: false,
    recheckRequested: false,
  };
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let unsubscribeWake: (() => void) | undefined;

  async function claimBatch(): Promise<readonly ClaimedRow[]> {
    const now = new Date(nowMs());
    const leaseUntil = new Date(now.getTime() + leaseMs);

    return options.database.db.transaction(async tx => {
      const rows = await tx
        .select({
          id: scheduledJobs.id,
          jobType: scheduledJobs.jobType,
          payload: scheduledJobs.payload,
          attempts: scheduledJobs.attempts,
          maxAttempts: scheduledJobs.maxAttempts,
        })
        .from(scheduledJobs)
        .where(and(eq(scheduledJobs.status, 'pending'), lte(scheduledJobs.runAt, now)))
        .orderBy(asc(scheduledJobs.runAt))
        .limit(batchSize)
        .for('update', {skipLocked: true});

      if (rows.length === 0) {
        return [];
      }

      const ids = rows.map(row => row.id);
      await tx
        .update(scheduledJobs)
        .set({
          status: 'processing',
          lockedBy: options.clusterId,
          leaseExpiresAt: leaseUntil,
          attempts: sql`${scheduledJobs.attempts} + 1`,
          updatedAt: now,
        })
        .where(inArray(scheduledJobs.id, ids));

      return rows.map(row => ({
        ...row,
        attempts: row.attempts + 1,
      }));
    });
  }

  async function reapExpiredLeasesAndPurge(): Promise<void> {
    const now = new Date(nowMs());
    const retentionCutoff = new Date(now.getTime() - COMPLETED_RETENTION_DAYS * 86_400_000);

    await options.database.db
      .update(scheduledJobs)
      .set({
        status: sql`CASE WHEN ${scheduledJobs.attempts} >= ${scheduledJobs.maxAttempts} THEN 'dead_letter' ELSE 'pending' END`,
        lockedBy: null,
        leaseExpiresAt: null,
        lastError: 'Lease expired before completion',
        updatedAt: now,
      })
      .where(and(eq(scheduledJobs.status, 'processing'), lt(scheduledJobs.leaseExpiresAt, now)));

    await options.database.db
      .delete(scheduledJobs)
      .where(
        and(eq(scheduledJobs.status, 'completed'), lt(scheduledJobs.updatedAt, retentionCutoff)),
      );
  }

  async function executeClaimedRow(row: ClaimedRow): Promise<void> {
    const handler = handlers.get(row.jobType);
    const now = new Date(nowMs());
    if (handler === undefined) {
      await options.database.db
        .update(scheduledJobs)
        .set({
          status: 'dead_letter',
          lockedBy: null,
          leaseExpiresAt: null,
          lastError: `No handler registered for jobType '${row.jobType}'`,
          updatedAt: now,
        })
        .where(eq(scheduledJobs.id, row.id));
      return;
    }

    const ctx: QueueJobContext = {
      id: row.id,
      jobType: row.jobType,
      payload: row.payload,
      attempts: row.attempts,
      maxAttempts: row.maxAttempts,
    };

    try {
      await handler(ctx);
      await options.database.db
        .update(scheduledJobs)
        .set({
          status: 'completed',
          lockedBy: null,
          leaseExpiresAt: null,
          updatedAt: new Date(nowMs()),
        })
        .where(eq(scheduledJobs.id, row.id));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      const isExhausted = row.attempts >= row.maxAttempts;
      const nextRunAt = new Date(nowMs() + computeBackoffMs(row.attempts));
      await options.database.db
        .update(scheduledJobs)
        .set({
          status: isExhausted ? 'dead_letter' : 'pending',
          runAt: isExhausted ? now : nextRunAt,
          lockedBy: null,
          leaseExpiresAt: null,
          lastError: message,
          updatedAt: new Date(nowMs()),
        })
        .where(eq(scheduledJobs.id, row.id));

      options.logger?.warn('queue.job.failed', {
        jobId: row.id,
        jobType: row.jobType,
        attempts: row.attempts,
        maxAttempts: row.maxAttempts,
        deadLetter: isExhausted,
        message,
      });
    }
  }

  async function pollOnce(): Promise<number> {
    if (runnerState.stopping) {
      return 0;
    }
    if (runnerState.isPolling) {
      runnerState.recheckRequested = true;
      return 0;
    }

    runnerState.isPolling = true;
    runnerState.recheckRequested = false;
    let totalProcessed = 0;
    try {
      await reapExpiredLeasesAndPurge();
      const claimed = await claimBatch();
      if (claimed.length > 0) {
        totalProcessed += claimed.length;
        const executions = claimed.map(async row => {
          const p = executeClaimedRow(row).finally(() => {
            inflightExecutions.delete(p);
          });
          inflightExecutions.add(p);
          await p;
        });
        await Promise.allSettled(executions);
        if (claimed.length === batchSize) {
          runnerState.recheckRequested = true;
        }
      }
    } catch (error: unknown) {
      const cause = error instanceof Error ? error.cause : undefined;
      options.logger?.error('queue.poll.error', {
        clusterId: options.clusterId,
        message: error instanceof Error ? error.message : String(error),
        cause:
          cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : undefined,
      });
    } finally {
      runnerState.isPolling = false;
    }

    if (runnerState.recheckRequested) {
      queueMicrotask(() => {
        void pollOnce();
      });
    }
    return totalProcessed;
  }

  return {
    enqueue: async (job: EnqueueJobOptions): Promise<Result<number, QueuePortError>> => {
      const runAt = job.runAt ?? new Date(nowMs());
      try {
        const inserted = await options.database.db
          .insert(scheduledJobs)
          .values({
            jobType: job.jobType,
            payload: {...job.payload},
            status: 'pending',
            runAt,
            maxAttempts: job.maxAttempts ?? 5,
            dedupeKey: job.dedupeKey,
          })
          .onConflictDoNothing()
          .returning({id: scheduledJobs.id});

        const jobId = inserted[0]?.id;
        if (jobId === undefined) {
          return err({
            code: 'duplicate_job',
            message: `Active job with dedupeKey '${job.dedupeKey ?? ''}' already exists`,
          });
        }

        if (options.valkey !== undefined && runAt.getTime() <= nowMs() + pollIntervalMs) {
          void options.valkey.publish(QUEUE_WAKE_CHANNEL, job.jobType).catch((error: unknown) => {
            options.logger?.warn('queue.wake.publish_failed', {
              jobType: job.jobType,
              message: error instanceof Error ? error.message : String(error),
            });
          });
        }

        return ok(jobId);
      } catch (error: unknown) {
        return err({
          code: 'enqueue_failed',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
    cancelByDedupeKey: async (dedupeKey: string): Promise<Result<boolean, QueuePortError>> => {
      try {
        const deleted = await options.database.db
          .delete(scheduledJobs)
          .where(and(eq(scheduledJobs.dedupeKey, dedupeKey), eq(scheduledJobs.status, 'pending')))
          .returning({id: scheduledJobs.id});
        return ok(deleted.length > 0);
      } catch (error: unknown) {
        return err({
          code: 'cancel_failed',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
    registerHandler: (jobType: string, handler: QueueJobHandler): Disposable => {
      handlers.set(jobType, handler);
      return toDisposable(() => {
        handlers.delete(jobType);
      });
    },
    start: async (): Promise<void> => {
      if (runnerState.started) {
        return;
      }
      runnerState.started = true;
      if (options.valkey !== undefined) {
        try {
          unsubscribeWake = await options.valkey.subscribe(QUEUE_WAKE_CHANNEL, () => {
            void pollOnce();
          });
        } catch (error: unknown) {
          options.logger?.warn('queue.wake.subscribe_failed', {
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
      pollTimer = setInterval(() => {
        void pollOnce();
      }, pollIntervalMs);
      void pollOnce();
    },
    pollOnce,
    disposeAsync: async (): Promise<void> => {
      runnerState.stopping = true;
      if (pollTimer !== undefined) {
        clearInterval(pollTimer);
        pollTimer = undefined;
      }
      unsubscribeWake?.();
      unsubscribeWake = undefined;
      if (inflightExecutions.size > 0) {
        await Promise.allSettled([...inflightExecutions]);
      }
    },
  };
}
