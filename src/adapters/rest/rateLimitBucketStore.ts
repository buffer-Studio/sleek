import {LRUCache} from 'lru-cache';
import {z} from 'zod';

import type {Disposable} from '../../base/common/disposable';
import type {PlatformId} from '../../base/common/platformId';
import type {ValkeyClient} from '../../platform/cache/valkeyClient';
import type {StructuredLogger} from '../../platform/logger/structuredLogger';

const GLOBAL_PAUSE_CHANNEL = 'sleek:ratelimit:global';
const INVALID_WINDOW_MS = 10 * 60 * 1000;
const DEFAULT_INVALID_THRESHOLD = 5000;

interface BucketState {
  limit: number;
  remaining: number;
  resetAtMs: number;
  tail: Promise<void>;
}

export interface RateLimitBucketStoreOptions {
  readonly valkey?: ValkeyClient;
  readonly logger?: StructuredLogger;
  readonly maxBuckets?: number;
  readonly bucketTtlMs?: number;
  readonly invalidRequestThreshold?: number;
  readonly nowMs?: () => number;
  readonly sleepMs?: (ms: number) => Promise<void>;
}

const globalPauseMessageSchema = z.object({
  platform: z.enum(['discord', 'fluxer']),
  pauseUntilMs: z.number(),
});

async function defaultSleep(ms: number): Promise<void> {
  await new Promise<void>(resolve => {
    setTimeout(resolve, ms);
  });
}

function parseHeaderNumber(headers: Headers, name: string): number | undefined {
  const raw = headers.get(name);
  if (raw === null) {
    return undefined;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export class RateLimitBucketStore implements Disposable {
  private readonly routeToBucket = new LRUCache<string, string>({
    max: 10_000,
    ttl: 15 * 60 * 1000,
  });
  private readonly buckets: LRUCache<string, BucketState>;
  private readonly globalPauseUntilByPlatform = new Map<PlatformId, number>();
  private readonly invalidTimestampsByPlatform = new Map<PlatformId, number[]>();
  private readonly invalidThreshold: number;
  private readonly valkey: ValkeyClient | undefined;
  private readonly logger: StructuredLogger | undefined;
  private readonly nowMs: () => number;
  private readonly sleepMs: (ms: number) => Promise<void>;
  private unsubscribeValkey: (() => void) | undefined;

  constructor(options: RateLimitBucketStoreOptions = {}) {
    this.valkey = options.valkey;
    this.logger = options.logger;
    this.invalidThreshold = options.invalidRequestThreshold ?? DEFAULT_INVALID_THRESHOLD;
    this.nowMs = options.nowMs ?? (() => Date.now());
    this.sleepMs = options.sleepMs ?? defaultSleep;
    this.buckets = new LRUCache<string, BucketState>({
      max: options.maxBuckets ?? 10_000,
      ttl: options.bucketTtlMs ?? 15 * 60 * 1000,
    });
  }

  public async initValkeySync(): Promise<void> {
    if (this.valkey === undefined || this.unsubscribeValkey !== undefined) {
      return;
    }
    try {
      this.unsubscribeValkey = await this.valkey.subscribe(
        GLOBAL_PAUSE_CHANNEL,
        (_channel, raw) => {
          this.handleGlobalPauseMessage(raw);
        },
      );
    } catch (error: unknown) {
      this.logger?.warn('rest.ratelimit.valkey_subscribe_failed', {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  public isCircuitOpen(platform: PlatformId, isCritical: boolean): boolean {
    if (isCritical) {
      return false;
    }
    const timestamps = this.pruneInvalidWindow(platform);
    return timestamps.length >= this.invalidThreshold;
  }

  public recordInvalidStatus(platform: PlatformId, status: number): void {
    if (status !== 401 && status !== 403 && status !== 429) {
      return;
    }
    const timestamps = this.pruneInvalidWindow(platform);
    timestamps.push(this.nowMs());
    if (timestamps.length === Math.floor(this.invalidThreshold * 0.8)) {
      this.logger?.warn('rest.invalid_requests.approaching_limit', {
        platform,
        count10m: timestamps.length,
        threshold: this.invalidThreshold,
      });
    }
  }

  public async acquireSlot<T>(
    options: {
      readonly platform: PlatformId;
      readonly routeKey: string;
      readonly majorParam: string;
      readonly exemptGlobalRateLimit: boolean;
    },
    fn: () => Promise<T>,
  ): Promise<T> {
    const routeComposite = `${options.platform}:${options.routeKey}:${options.majorParam}`;
    const bucketKey = this.routeToBucket.get(routeComposite) ?? routeComposite;
    let state = this.buckets.get(bucketKey);
    if (state === undefined) {
      state = {
        limit: 1,
        remaining: 1,
        resetAtMs: 0,
        tail: Promise.resolve(),
      };
      this.buckets.set(bucketKey, state);
    }

    const previous = state.tail;
    let releaseCurrent: (() => void) | undefined;
    state.tail = new Promise<void>(resolve => {
      releaseCurrent = resolve;
    });

    await previous;
    try {
      if (!options.exemptGlobalRateLimit) {
        const globalUntil = this.globalPauseUntilByPlatform.get(options.platform) ?? 0;
        const globalWait = globalUntil - this.nowMs();
        if (globalWait > 0) {
          await this.sleepMs(globalWait);
        }
      }

      const now = this.nowMs();
      if (state.remaining <= 0 && state.resetAtMs > now) {
        await this.sleepMs(state.resetAtMs - now);
      }

      return await fn();
    } finally {
      releaseCurrent?.();
    }
  }

  public updateFromHeaders(
    platform: PlatformId,
    routeKey: string,
    majorParam: string,
    headers: Headers,
  ): void {
    const routeComposite = `${platform}:${routeKey}:${majorParam}`;
    const bucketHash = headers.get('x-ratelimit-bucket');
    const resolvedBucketKey =
      bucketHash !== null && bucketHash.length > 0
        ? `${platform}:bucket:${bucketHash}:${majorParam}`
        : routeComposite;

    if (resolvedBucketKey !== routeComposite) {
      this.routeToBucket.set(routeComposite, resolvedBucketKey);
    }

    const limit = parseHeaderNumber(headers, 'x-ratelimit-limit');
    const remaining = parseHeaderNumber(headers, 'x-ratelimit-remaining');
    const resetAfterSec = parseHeaderNumber(headers, 'x-ratelimit-reset-after');
    const resetEpochSec = parseHeaderNumber(headers, 'x-ratelimit-reset');

    const now = this.nowMs();
    const resetAtMs =
      resetAfterSec !== undefined
        ? now + Math.ceil(resetAfterSec * 1000)
        : resetEpochSec !== undefined
          ? Math.ceil(resetEpochSec * 1000)
          : now;

    const existing = this.buckets.get(resolvedBucketKey) ?? this.buckets.get(routeComposite);
    this.buckets.set(resolvedBucketKey, {
      limit: limit ?? existing?.limit ?? 1,
      remaining: remaining ?? existing?.remaining ?? 1,
      resetAtMs,
      tail: existing?.tail ?? Promise.resolve(),
    });
  }

  public notifyGlobalPause(platform: PlatformId, retryAfterMs: number): void {
    const pauseUntilMs = this.nowMs() + Math.max(0, retryAfterMs);
    const current = this.globalPauseUntilByPlatform.get(platform) ?? 0;
    if (pauseUntilMs > current) {
      this.globalPauseUntilByPlatform.set(platform, pauseUntilMs);
    }
    if (this.valkey !== undefined) {
      const payload = JSON.stringify({platform, pauseUntilMs});
      void this.valkey.publish(GLOBAL_PAUSE_CHANNEL, payload).catch((error: unknown) => {
        this.logger?.warn('rest.ratelimit.valkey_publish_failed', {
          message: error instanceof Error ? error.message : String(error),
        });
      });
    }
  }

  public dispose(): void {
    this.unsubscribeValkey?.();
    this.unsubscribeValkey = undefined;
  }

  private handleGlobalPauseMessage(raw: string): void {
    try {
      const parsed = globalPauseMessageSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) {
        return;
      }
      const {platform, pauseUntilMs} = parsed.data;
      const current = this.globalPauseUntilByPlatform.get(platform) ?? 0;
      if (pauseUntilMs > current) {
        this.globalPauseUntilByPlatform.set(platform, pauseUntilMs);
      }
    } catch {
      // ignore malformed pub/sub payloads
    }
  }

  private pruneInvalidWindow(platform: PlatformId): number[] {
    const cutoff = this.nowMs() - INVALID_WINDOW_MS;
    const list = this.invalidTimestampsByPlatform.get(platform) ?? [];
    let firstValid = 0;
    while (firstValid < list.length && (list[firstValid] ?? 0) < cutoff) {
      firstValid += 1;
    }
    if (firstValid > 0) {
      list.splice(0, firstValid);
    }
    this.invalidTimestampsByPlatform.set(platform, list);
    return list;
  }
}
