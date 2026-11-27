import type {Disposable} from '../../base/common/disposable';
import type {Result} from '../../base/common/result';

export interface QueuePortError {
  readonly code: string;
  readonly message: string;
}

export interface EnqueueJobOptions {
  readonly jobType: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly runAt?: Date;
  readonly maxAttempts?: number;
  readonly dedupeKey?: string;
}

export interface QueueJobContext {
  readonly id: number;
  readonly jobType: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly attempts: number;
  readonly maxAttempts: number;
}

export type QueueJobHandler = (job: QueueJobContext) => Promise<void>;

export interface QueuePort {
  readonly enqueue: (options: EnqueueJobOptions) => Promise<Result<number, QueuePortError>>;
  readonly cancelByDedupeKey: (dedupeKey: string) => Promise<Result<boolean, QueuePortError>>;
  readonly registerHandler: (jobType: string, handler: QueueJobHandler) => Disposable;
}
