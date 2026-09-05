export type AmdFflAwardBenchmark = {
  category: 'offensive_rookie' | 'defensive_rookie';
  seasons: number;
  averageWinningPoints: number;
  medianWinningPoints: number;
  recentWinningPoints: number[];
  positionWins: Record<string, number>;
};

/**
 * League-specific historical context copied from the normalized AMD FFL awards archive.
 * Keep this intentionally small: Fantasy Edge uses it as a decision lens, not as a
 * substitute for current-season projections.
 */
export const AMDFFL_ROOKIE_AWARD_BENCHMARKS: AmdFflAwardBenchmark[] = [
  {
    category: 'offensive_rookie',
    seasons: 20,
    averageWinningPoints: 205.54,
    medianWinningPoints: 201.85,
    recentWinningPoints: [247, 159.7, 199, 265.45, 183.4],
    positionWins: { QB: 6, RB: 11, WR: 3 },
  },
  {
    category: 'defensive_rookie',
    seasons: 20,
    averageWinningPoints: 149.42,
    medianWinningPoints: 150.03,
    recentWinningPoints: [215.7, 161.55, 99.62, 120.17, 204.59],
    positionWins: { DL: 1, LB: 16, DB: 3 },
  },
];

export function rookieAwardBenchmark(position = '') {
  const normalized = position.toUpperCase();
  const category = ['DL', 'LB', 'DB'].includes(normalized) ? 'defensive_rookie' : 'offensive_rookie';
  return AMDFFL_ROOKIE_AWARD_BENCHMARKS.find(item => item.category === category)!;
}
