import {describe, expect, it} from 'bun:test';

import {TieredCache} from './tieredCache';

describe('TieredCache', () => {
  it('coalesces concurrent cold misses into a single loader invocation', async () => {
    const cache = new TieredCache<string, {readonly prefix: string}>();
    let loaderCalls = 0;

    const results = await Promise.all(
      Array.from({length: 25}, () =>
        cache.getOrLoad('discord:123', async () => {
          loaderCalls += 1;
          await Bun.sleep(5);
          return {prefix: ','};
        }),
      ),
    );

    expect(loaderCalls).toBe(1);
    expect(results.every(item => item?.prefix === ',')).toBe(true);
  });

  it('prevents stale in-flight L3 reads from poisoning L1 after invalidation', async () => {
    const cache = new TieredCache<string, {readonly prefix: string}>();

    let resolveLoad: ((val: {readonly prefix: string}) => void) | undefined;
    const pending = cache.getOrLoad(
      'discord:456',
      async () =>
        new Promise<{readonly prefix: string}>(resolve => {
          resolveLoad = resolve;
        }),
    );

    await Bun.sleep(1);
    cache.invalidate('discord:456');
    resolveLoad?.({prefix: 'stale'});

    const firstResult = await pending;
    expect(firstResult?.prefix).toBe('stale');

    let reloaded = false;
    const secondResult = await cache.getOrLoad('discord:456', () => {
      reloaded = true;
      return Promise.resolve({prefix: 'fresh'});
    });

    expect(reloaded).toBe(true);
    expect(secondResult?.prefix).toBe('fresh');
  });
});
