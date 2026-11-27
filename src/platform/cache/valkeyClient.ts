import type {AsyncDisposable} from '../../base/common/asyncDisposable';
import {createServiceKey} from '../di/serviceKey';

export type ValkeyMessageHandler = (channel: string, message: string) => void;

export interface ValkeyClient extends AsyncDisposable {
  readonly get: (key: string) => Promise<string | undefined>;
  readonly set: (key: string, value: string, ttlSeconds?: number) => Promise<void>;
  readonly del: (...keys: readonly string[]) => Promise<number>;
  readonly sadd: (key: string, ...members: readonly string[]) => Promise<number>;
  readonly srem: (key: string, ...members: readonly string[]) => Promise<number>;
  readonly smembers: (key: string) => Promise<readonly string[]>;
  readonly sismember: (key: string, member: string) => Promise<boolean>;
  readonly evalScript: (
    script: string,
    keys: readonly string[],
    args: ReadonlyArray<string | number>,
  ) => Promise<unknown>;
  readonly publish: (channel: string, message: string) => Promise<number>;
  readonly subscribe: (channel: string, handler: ValkeyMessageHandler) => Promise<() => void>;
  readonly healthCheck: () => Promise<boolean>;
}

export const VALKEY_CLIENT_KEY = createServiceKey<ValkeyClient>('platform.cache.valkey');

interface IoValkeyLike {
  get: (key: string) => Promise<string | null>;
  set: (...args: Array<string | number>) => Promise<unknown>;
  del: (...keys: string[]) => Promise<number>;
  sadd: (key: string, ...members: string[]) => Promise<number>;
  srem: (key: string, ...members: string[]) => Promise<number>;
  smembers: (key: string) => Promise<string[]>;
  sismember: (key: string, member: string) => Promise<number>;
  eval: (script: string, numKeys: number, ...args: Array<string | number>) => Promise<unknown>;
  publish: (channel: string, message: string) => Promise<number>;
  subscribe: (...channels: string[]) => Promise<unknown>;
  unsubscribe: (...channels: string[]) => Promise<unknown>;
  on: (event: string, listener: (channel: string, message: string) => void) => void;
  ping: () => Promise<string>;
  quit: () => Promise<unknown>;
}

export async function createValkeyClient(valkeyUrl: string): Promise<ValkeyClient> {
  const {default: valkeyCtor} = await import('iovalkey');
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  const primary = new valkeyCtor(valkeyUrl, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: false,
  }) as unknown as IoValkeyLike;

  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  const subscriber = new valkeyCtor(valkeyUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: false,
  }) as unknown as IoValkeyLike;

  const channelHandlers = new Map<string, Set<ValkeyMessageHandler>>();

  subscriber.on('message', (channel: string, message: string) => {
    const handlers = channelHandlers.get(channel);
    if (handlers === undefined) {
      return;
    }
    for (const handler of handlers) {
      handler(channel, message);
    }
  });

  return {
    get: async (key: string): Promise<string | undefined> => {
      const value = await primary.get(key);
      return value ?? undefined;
    },
    set: async (key: string, value: string, ttlSeconds?: number): Promise<void> => {
      if (ttlSeconds !== undefined && ttlSeconds > 0) {
        await primary.set(key, value, 'EX', Math.trunc(ttlSeconds));
        return;
      }
      await primary.set(key, value);
    },
    del: async (...keys: readonly string[]): Promise<number> => {
      if (keys.length === 0) {
        return 0;
      }
      return primary.del(...keys);
    },
    sadd: async (key: string, ...members: readonly string[]): Promise<number> => {
      if (members.length === 0) {
        return 0;
      }
      return primary.sadd(key, ...members);
    },
    srem: async (key: string, ...members: readonly string[]): Promise<number> => {
      if (members.length === 0) {
        return 0;
      }
      return primary.srem(key, ...members);
    },
    smembers: async (key: string): Promise<readonly string[]> => primary.smembers(key),
    sismember: async (key: string, member: string): Promise<boolean> => {
      const res = await primary.sismember(key, member);
      return res === 1;
    },
    evalScript: async (
      script: string,
      keys: readonly string[],
      args: ReadonlyArray<string | number>,
    ): Promise<unknown> => primary.eval(script, keys.length, ...keys, ...args),
    publish: async (channel: string, message: string): Promise<number> =>
      primary.publish(channel, message),
    subscribe: async (channel: string, handler: ValkeyMessageHandler): Promise<() => void> => {
      let handlers = channelHandlers.get(channel);
      if (handlers === undefined) {
        handlers = new Set();
        channelHandlers.set(channel, handlers);
        await subscriber.subscribe(channel);
      }
      handlers.add(handler);
      return (): void => {
        const set = channelHandlers.get(channel);
        if (set === undefined) {
          return;
        }
        set.delete(handler);
        if (set.size === 0) {
          channelHandlers.delete(channel);
          void subscriber.unsubscribe(channel);
        }
      };
    },
    healthCheck: async (): Promise<boolean> => {
      try {
        const pong = await primary.ping();
        return pong === 'PONG';
      } catch {
        return false;
      }
    },
    disposeAsync: async (): Promise<void> => {
      await Promise.allSettled([subscriber.quit(), primary.quit()]);
    },
  };
}
