import { buildAnswerClusters } from './answer-clusters';

describe('buildAnswerClusters', () => {
  it('returns no clouds for an empty crowd', () => {
    expect(buildAnswerClusters([], 1)).toEqual([])
  })

  it('groups nearby answers and keeps distant areas separate', () => {
    expect(buildAnswerClusters([10, 11, 12, 100], 1)).toEqual([
      { center: 11, count: 3, minimum: 10, maximum: 12 },
      { center: 100, count: 1, minimum: 100, maximum: 100 },
    ]);
  });

  it('limits the chart to eight readable clouds', () => {
    const clusters = buildAnswerClusters(
      Array.from({ length: 9 }, (_, index) => index * 121),
      1,
    );

    expect(clusters).toHaveLength(8);
    expect(clusters.reduce((total, cluster) => total + cluster.count, 0)).toBe(
      9,
    );
  });

  it('returns one exact-value cloud when every answer matches', () => {
    expect(buildAnswerClusters([42, 42, 42], 1)).toEqual([
      { center: 42, count: 3, minimum: 42, maximum: 42 },
    ]);
  });
});
