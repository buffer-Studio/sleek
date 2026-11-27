import type {PlatformId} from '../../core/ports/gateway.port';

export interface IdentifyCoordinatorOptions {
  readonly maxConcurrency?: number;
  readonly intervalMs?: number;
  readonly nowFn?: () => number;
  readonly scheduleFn?: (cb: () => void, delayMs: number) => void;
}

export interface IdentifyCoordinator {
  enqueue: (platform: PlatformId, shardId: number, onGrant: () => void) => void;
}

export function createIdentifyCoordinator(
  options: IdentifyCoordinatorOptions = {},
): IdentifyCoordinator {
  const maxConcurrency = Math.max(1, options.maxConcurrency ?? 1);
  const intervalMs = Math.max(0, options.intervalMs ?? 5000);
  const nowFn = options.nowFn ?? Date.now;
  const scheduleFn =
    options.scheduleFn ??
    ((cb: () => void, delayMs: number): void => {
      const timer = setTimeout(cb, delayMs);
      if (typeof timer === 'object' && 'unref' in timer) {
        timer.unref();
      }
    });

  const nextAvailableAt = new Map<string, number>();

  return {
    enqueue: (platform: PlatformId, shardId: number, onGrant: () => void): void => {
      const bucket = platform === 'discord' ? shardId % maxConcurrency : 0;
      const key = `${platform}:${bucket}`;
      const now = nowFn();
      const readyAt = Math.max(now, nextAvailableAt.get(key) ?? now);
      const delayMs = readyAt - now;
      nextAvailableAt.set(key, readyAt + intervalMs);

      if (delayMs <= 0) {
        onGrant();
      } else {
        scheduleFn(onGrant, delayMs);
      }
    },
  };
}
