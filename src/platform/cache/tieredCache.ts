import {LRUCache} from 'lru-cache';

export interface TieredCacheOptions {
  readonly l1MaxEntries?: number;
  readonly l1TtlMs?: number;
}

export class TieredCache<TKey extends string, TValue extends object> {
  private readonly l1: LRUCache<TKey, TValue>;
  private readonly inflight = new Map<TKey, Promise<TValue | undefined>>();
  private readonly epochs = new Map<TKey, number>();

  constructor(options: TieredCacheOptions = {}) {
    this.l1 = new LRUCache<TKey, TValue>({
      max: options.l1MaxEntries ?? 10_000,
      ttl: options.l1TtlMs ?? 60_000,
    });
  }

  public getEpoch(key: TKey): number {
    return this.epochs.get(key) ?? 0;
  }

  public async getOrLoad(
    key: TKey,
    loader: () => Promise<TValue | undefined>,
  ): Promise<TValue | undefined> {
    const cached = this.l1.get(key);
    if (cached !== undefined) {
      return cached;
    }

    const existingInflight = this.inflight.get(key);
    if (existingInflight !== undefined) {
      return existingInflight;
    }

    const startEpoch = this.getEpoch(key);
    const loadPromise = (async (): Promise<TValue | undefined> => {
      try {
        const loaded = await loader();
        if (loaded !== undefined && this.getEpoch(key) === startEpoch) {
          this.l1.set(key, loaded);
        }
        return loaded;
      } finally {
        this.inflight.delete(key);
      }
    })();

    this.inflight.set(key, loadPromise);
    return loadPromise;
  }

  public set(key: TKey, value: TValue): void {
    this.epochs.set(key, this.getEpoch(key) + 1);
    this.l1.set(key, value);
  }

  public invalidate(key: TKey): void {
    this.epochs.set(key, this.getEpoch(key) + 1);
    this.l1.delete(key);
  }

  public clear(): void {
    for (const key of this.l1.keys()) {
      this.epochs.set(key, this.getEpoch(key) + 1);
    }
    this.l1.clear();
  }
}
