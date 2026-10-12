/** Pure eligibility, ordering and search over leaderboard entries. */
import type { NotRankedReason, RankBy } from 'constants/leaderboard';
import type { LeaderboardMetrics } from 'types/leaderboard';

export type RankCandidate = {
  address: string;
  metrics: LeaderboardMetrics & { settledBets: number; settledCost: number };
  hasSettledActivity: boolean;
};

/**
 * `null` when the agent is ranked in the window, otherwise why not. An agent is ranked with at
 * least `minSettledBets` settled bets in the window and a settled cost (the ROI denominator)
 * of at least `minSettledCost`, so that its ROI is meaningful.
 */
export const getNotRankedReason = (
  candidate: RankCandidate,
  { minSettledBets, minSettledCost }: { minSettledBets: number; minSettledCost: number },
): NotRankedReason | null => {
  if (!candidate.hasSettledActivity) return 'not_ranked_yet';
  const { settledBets, settledCost } = candidate.metrics;
  if (settledBets < minSettledBets || settledCost < minSettledCost) {
    return 'not_enough_trades_in_window';
  }
  return null;
};

/** Highest value first, ties by trades descending, then by address ascending */
export const compareByCriterion =
  (rankBy: RankBy) =>
  (
    a: { address: string; metrics: { roi: number; pnl: number; trades: number } },
    b: { address: string; metrics: { roi: number; pnl: number; trades: number } },
  ) => {
    const byValue = b.metrics[rankBy] - a.metrics[rankBy];
    if (byValue !== 0) return byValue;
    const byTrades = b.metrics.trades - a.metrics.trades;
    if (byTrades !== 0) return byTrades;
    return a.address < b.address ? -1 : a.address > b.address ? 1 : 0;
  };

/** Ranks (1-based) of the eligible candidates under one criterion, by address */
export const assignRanks = (
  eligible: { address: string; metrics: { roi: number; pnl: number; trades: number } }[],
  rankBy: RankBy,
): Map<string, number> => {
  const ranks = new Map<string, number>();
  [...eligible]
    .sort(compareByCriterion(rankBy))
    .forEach((candidate, index) => ranks.set(candidate.address, index + 1));
  return ranks;
};

export const normalizeSearch = (search: string | undefined | null) =>
  (search ?? '').trim().toLowerCase();

/**
 * Agents whose name contains `search` (case-insensitive): first the ranked matches by rank,
 * then the matches not ranked in this window, by name.
 */
export const searchByName = <T extends { name: string; rank: number | null }>(
  agents: T[],
  search: string,
): T[] => {
  const query = normalizeSearch(search);
  const matches = agents.filter((agent) => agent.name.toLowerCase().includes(query));
  const ranked = matches
    .filter((agent) => agent.rank !== null)
    .sort((a, b) => (a.rank as number) - (b.rank as number));
  const notRanked = matches
    .filter((agent) => agent.rank === null)
    .sort((a, b) => a.name.localeCompare(b.name));
  return [...ranked, ...notRanked];
};
