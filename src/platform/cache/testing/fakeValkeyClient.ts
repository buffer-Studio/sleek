import type {ValkeyClient, ValkeyMessageHandler} from '../valkeyClient';

interface StringEntry {
  readonly value: string;
  readonly expiresAtMs: number | undefined;
}

export class FakeValkeyClient implements ValkeyClient {
  private readonly kv = new Map<string, StringEntry>();
  private readonly sets = new Map<string, Set<string>>();
  private readonly subscribers = new Map<string, Set<ValkeyMessageHandler>>();
  public disposed = false;

  public async get(key: string): Promise<string | undefined> {
    const entry = this.kv.get(key);
    if (entry === undefined) {
      return Promise.resolve(undefined);
    }
    if (entry.expiresAtMs !== undefined && Date.now() >= entry.expiresAtMs) {
      this.kv.delete(key);
      return Promise.resolve(undefined);
    }
    return Promise.resolve(entry.value);
  }

  public async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    const expiresAtMs =
      ttlSeconds !== undefined && ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : undefined;
    this.kv.set(key, {value, expiresAtMs});
    return Promise.resolve();
  }

  public async del(...keys: readonly string[]): Promise<number> {
    let removed = 0;
    for (const key of keys) {
      const deletedKv = this.kv.delete(key);
      const deletedSet = this.sets.delete(key);
      if (deletedKv || deletedSet) {
        removed += 1;
      }
    }
    return Promise.resolve(removed);
  }

  public async sadd(key: string, ...members: readonly string[]): Promise<number> {
    let set = this.sets.get(key);
    if (set === undefined) {
      set = new Set();
      this.sets.set(key, set);
    }
    let added = 0;
    for (const member of members) {
      if (!set.has(member)) {
        set.add(member);
        added += 1;
      }
    }
    return Promise.resolve(added);
  }

  public async srem(key: string, ...members: readonly string[]): Promise<number> {
    const set = this.sets.get(key);
    if (set === undefined) {
      return Promise.resolve(0);
    }
    let removed = 0;
    for (const member of members) {
      if (set.delete(member)) {
        removed += 1;
      }
    }
    return Promise.resolve(removed);
  }

  public async smembers(key: string): Promise<readonly string[]> {
    const set = this.sets.get(key);
    return Promise.resolve(set === undefined ? [] : [...set]);
  }

  public async sismember(key: string, member: string): Promise<boolean> {
    return Promise.resolve(this.sets.get(key)?.has(member) ?? false);
  }

  public async evalScript(
    _script: string,
    _keys: readonly string[],
    _args: ReadonlyArray<string | number>,
  ): Promise<unknown> {
    return Promise.resolve(undefined);
  }

  public async publish(channel: string, message: string): Promise<number> {
    const handlers = this.subscribers.get(channel);
    if (handlers === undefined) {
      return Promise.resolve(0);
    }
    for (const handler of handlers) {
      handler(channel, message);
    }
    return Promise.resolve(handlers.size);
  }

  public async subscribe(channel: string, handler: ValkeyMessageHandler): Promise<() => void> {
    let handlers = this.subscribers.get(channel);
    if (handlers === undefined) {
      handlers = new Set();
      this.subscribers.set(channel, handlers);
    }
    handlers.add(handler);
    return Promise.resolve((): void => {
      handlers.delete(handler);
    });
  }

  public async healthCheck(): Promise<boolean> {
    return Promise.resolve(!this.disposed);
  }

  public async disposeAsync(): Promise<void> {
    this.disposed = true;
    this.kv.clear();
    this.sets.clear();
    this.subscribers.clear();
    return Promise.resolve();
  }
}
