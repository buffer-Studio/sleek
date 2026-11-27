export interface ClusterAssignment {
  readonly clusterId: string;
  readonly clusterIndex: number;
  readonly shardStart: number;
  readonly shardEnd: number;
  readonly totalShards: number;
}

export function computeTotalShards(
  guildCount: number,
  recommendedShards = 1,
  guildsPerShard = 500,
): number {
  const safePerShard = Math.max(1, guildsPerShard);
  const byGuilds = Math.ceil(Math.max(0, guildCount) / safePerShard);
  return Math.max(1, recommendedShards, byGuilds);
}

export function shouldReshard(
  guildCount: number,
  currentShards: number,
  reshardThreshold = 650,
): boolean {
  const safeShards = Math.max(1, currentShards);
  return guildCount / safeShards > reshardThreshold;
}

export function computeClusterPlan(
  totalShards: number,
  shardsPerCluster = 4,
): readonly ClusterAssignment[] {
  const safeTotal = Math.max(1, totalShards);
  const safePerCluster = Math.max(1, shardsPerCluster);
  const clusters: ClusterAssignment[] = [];

  for (let start = 0, index = 0; start < safeTotal; start += safePerCluster, index += 1) {
    const end = Math.min(safeTotal - 1, start + safePerCluster - 1);
    clusters.push({
      clusterId: `C${index}`,
      clusterIndex: index,
      shardStart: start,
      shardEnd: end,
      totalShards: safeTotal,
    });
  }

  return clusters;
}
