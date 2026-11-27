import {describe, expect, it} from 'bun:test';

import {computeClusterPlan, computeTotalShards, shouldReshard} from './shardingMath';

describe('shardingMath', () => {
  it('computes 500 guilds per shard with a minimum of 1 shard', () => {
    expect(computeTotalShards(0, 1, 500)).toBe(1);
    expect(computeTotalShards(500, 1, 500)).toBe(1);
    expect(computeTotalShards(501, 1, 500)).toBe(2);
    expect(computeTotalShards(1200, 4, 500)).toBe(4);
  });

  it('triggers resharding only above the 650 guilds/shard hysteresis threshold', () => {
    expect(shouldReshard(650, 1, 650)).toBe(false);
    expect(shouldReshard(651, 1, 650)).toBe(true);
    expect(shouldReshard(2600, 4, 650)).toBe(false);
    expect(shouldReshard(2601, 4, 650)).toBe(true);
  });

  it('partitions uneven shard counts into contiguous cluster assignments', () => {
    const plan = computeClusterPlan(5, 4);
    expect(plan).toEqual([
      {clusterId: 'C0', clusterIndex: 0, shardStart: 0, shardEnd: 3, totalShards: 5},
      {clusterId: 'C1', clusterIndex: 1, shardStart: 4, shardEnd: 4, totalShards: 5},
    ]);
  });
});
