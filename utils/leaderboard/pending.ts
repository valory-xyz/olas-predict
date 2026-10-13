/**
 * Back-off for settled markets the builder could not tally yet (no final answer, or no bets
 * returned): each miss doubles the wait before the next lookup, so markets that never resolve
 * do not cost every hourly run a lookup.
 */

/** [last lookup (epoch ms), lookups in a row that left the market untallied] */
export type PendingMarketCheck = [number, number];

/** Wait after the first miss: the next hourly run */
export const PENDING_MARKET_RECHECK_MS = 60 * 60 * 1000;
export const PENDING_MARKET_MAX_RECHECK_MS = 24 * 60 * 60 * 1000;
/** Runs start a few seconds apart from hour to hour; don't let that skip a run */
const RUN_JITTER_MS = 10 * 60 * 1000;

/** Whether a pending market is due for another lookup */
export const needsMarketCheck = (check: PendingMarketCheck | undefined, now: number): boolean => {
  if (!check) return true;
  const [checkedAt, misses] = check;
  const wait = Math.min(
    PENDING_MARKET_MAX_RECHECK_MS,
    PENDING_MARKET_RECHECK_MS * 2 ** Math.max(misses - 1, 0),
  );
  return now - checkedAt >= wait - RUN_JITTER_MS;
};

/** The check after a lookup that left the market untallied */
export const recordMarketMiss = (
  check: PendingMarketCheck | undefined,
  now: number,
): PendingMarketCheck => [now, (check?.[1] ?? 0) + 1];
