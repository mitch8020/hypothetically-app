export interface AnswerCluster {
  center: number;
  count: number;
  minimum: number;
  maximum: number;
}

const MAX_CLUSTERS = 8;

interface ClusterAccumulator {
  count: number;
  minimum: number;
  maximum: number;
  sum: number;
}

export function buildAnswerClusters(
  values: readonly number[],
  step: number,
): AnswerCluster[] {
  if (values.length === 0) return [];

  const sorted = [...values].sort((left, right) => left - right);
  const range = sorted[sorted.length - 1] - sorted[0];
  const proximity = Math.max(step * 3, range * 0.12);
  const clusters: ClusterAccumulator[] = [];

  for (const value of sorted) {
    const current = clusters[clusters.length - 1];
    if (current && value - current.maximum <= proximity) {
      current.count += 1;
      current.maximum = value;
      current.sum += value;
      continue;
    }

    clusters.push({
      count: 1,
      minimum: value,
      maximum: value,
      sum: value,
    });
  }

  while (clusters.length > MAX_CLUSTERS) {
    let mergeIndex = 0;
    let smallestGap = Number.POSITIVE_INFINITY;

    for (let index = 0; index < clusters.length - 1; index += 1) {
      const gap =
        clusters[index + 1].sum / clusters[index + 1].count -
        clusters[index].sum / clusters[index].count;
      if (gap < smallestGap) {
        smallestGap = gap;
        mergeIndex = index;
      }
    }

    const left = clusters[mergeIndex];
    const right = clusters[mergeIndex + 1];
    clusters.splice(mergeIndex, 2, {
      count: left.count + right.count,
      minimum: left.minimum,
      maximum: right.maximum,
      sum: left.sum + right.sum,
    });
  }

  return clusters.map((cluster) => ({
    center: cluster.sum / cluster.count,
    count: cluster.count,
    minimum: cluster.minimum,
    maximum: cluster.maximum,
  }));
}
