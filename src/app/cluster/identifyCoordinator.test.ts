import {describe, expect, it} from 'bun:test';

import {createIdentifyCoordinator} from './identifyCoordinator';

describe('IdentifyCoordinator', () => {
  it('paces shards in the same concurrency bucket by 5000ms and allows parallel buckets', () => {
    const delays: number[] = [];
    const granted: number[] = [];
    const coordinator = createIdentifyCoordinator({
      maxConcurrency: 2,
      intervalMs: 5000,
      nowFn: () => 1000,
      scheduleFn: (cb, delayMs) => {
        delays.push(delayMs);
        cb();
      },
    });

    // shard 0 -> bucket 0 (immediate)
    coordinator.enqueue('discord', 0, () => granted.push(0));
    // shard 1 -> bucket 1 (immediate, parallel bucket)
    coordinator.enqueue('discord', 1, () => granted.push(1));
    // shard 2 -> bucket 0 (delayed by 5000ms)
    coordinator.enqueue('discord', 2, () => granted.push(2));

    expect(delays).toEqual([5000]);
    expect(granted).toEqual([0, 1, 2]);
  });
});
