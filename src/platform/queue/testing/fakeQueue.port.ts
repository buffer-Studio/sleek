import {type Disposable, toDisposable} from '../../../base/common/disposable';
import {err, ok, type Result} from '../../../base/common/result';
import type {
  EnqueueJobOptions,
  QueueJobContext,
  QueueJobHandler,
  QueuePort,
  QueuePortError,
} from '../queue.port';

export interface FakeQueueRecord {
  readonly id: number;
  readonly jobType: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly runAtMs: number;
  readonly dedupeKey?: string;
  readonly maxAttempts: number;
  attempts: number;
  status: 'pending' | 'completed' | 'dead_letter' | 'cancelled';
}

export interface FakeQueuePort extends QueuePort {
  readonly jobs: readonly FakeQueueRecord[];
  readonly drainDue: (nowMs?: number) => Promise<number>;
}

export function createFakeQueuePort(): FakeQueuePort {
  let nextId = 1;
  const jobs: FakeQueueRecord[] = [];
  const handlers = new Map<string, QueueJobHandler>();

  return {
    jobs,
    enqueue: async (options: EnqueueJobOptions): Promise<Result<number, QueuePortError>> => {
      await Promise.resolve();
      if (options.dedupeKey !== undefined) {
        const duplicate = jobs.some(
          job => job.dedupeKey === options.dedupeKey && job.status === 'pending',
        );
        if (duplicate) {
          return err({
            code: 'duplicate_job',
            message: `Duplicate dedupeKey '${options.dedupeKey}'`,
          });
        }
      }
      const id = nextId;
      nextId += 1;
      jobs.push({
        id,
        jobType: options.jobType,
        payload: options.payload,
        runAtMs: (options.runAt ?? new Date()).getTime(),
        dedupeKey: options.dedupeKey,
        maxAttempts: options.maxAttempts ?? 5,
        attempts: 0,
        status: 'pending',
      });
      return ok(id);
    },
    cancelByDedupeKey: async (dedupeKey: string): Promise<Result<boolean, QueuePortError>> => {
      await Promise.resolve();
      let cancelled = false;
      for (const job of jobs) {
        if (job.dedupeKey === dedupeKey && job.status === 'pending') {
          job.status = 'cancelled';
          cancelled = true;
        }
      }
      return ok(cancelled);
    },
    registerHandler: (jobType: string, handler: QueueJobHandler): Disposable => {
      handlers.set(jobType, handler);
      return toDisposable(() => {
        handlers.delete(jobType);
      });
    },
    drainDue: async (nowMs = Date.now()): Promise<number> => {
      let processed = 0;
      for (const job of jobs) {
        if (job.status !== 'pending' || job.runAtMs > nowMs) {
          continue;
        }
        const handler = handlers.get(job.jobType);
        if (handler === undefined) {
          job.status = 'dead_letter';
          continue;
        }
        job.attempts += 1;
        const ctx: QueueJobContext = {
          id: job.id,
          jobType: job.jobType,
          payload: job.payload,
          attempts: job.attempts,
          maxAttempts: job.maxAttempts,
        };
        try {
          await handler(ctx);
          job.status = 'completed';
          processed += 1;
        } catch {
          if (job.attempts >= job.maxAttempts) {
            job.status = 'dead_letter';
          }
        }
      }
      return processed;
    },
  };
}
