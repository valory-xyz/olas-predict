/**
 * When to look up again a settled market the builder could not tally yet.
 *
 * - A market that is only waiting out its answer timeout (an Omen market with an answer, no
 *   arbitration, finalizing later) is due at its finalization time, without a miss: every Omen
 *   market spends a day like this after its first answer.
 * - Any other lookup that left it untallied (no answer, arbitration, missing from the source,
 *   no bets returned) is a miss: each miss doubles the wait before the next lookup, so markets
 *   that never resolve do not cost every hourly run a lookup.
 */

/** [next lookup due (epoch ms), lookups in a row that missed] */
export type PendingMarketCheck = [number, number];

/** Wait after the first miss: the next hourly run */
export const PENDING_MARKET_RECHECK_MS = 60 * 60 * 1000;
export const PENDING_MARKET_MAX_RECHECK_MS = 24 * 60 * 60 * 1000;
/** Runs start a few seconds apart from hour to hour; don't let that skip a run */
const RUN_JITTER_MS = 10 * 60 * 1000;

/** Whether a pending market is due for another lookup */
export const needsMarketCheck = (check: PendingMarketCheck | undefined, now: number): boolean =>
  !check || now >= check[0] - RUN_JITTER_MS;

/** The check after a lookup that missed */
export const recordMarketMiss = (
  check: PendingMarketCheck | undefined,
  now: number,
): PendingMarketCheck => {
  const misses = (check?.[1] ?? 0) + 1;
  const wait = Math.min(
    PENDING_MARKET_MAX_RECHECK_MS,
    PENDING_MARKET_RECHECK_MS * 2 ** (misses - 1),
  );
  return [now + wait, misses];
};

/** The check of a market that becomes final at `finalizesAt` (epoch ms): due then, no miss */
export const recordMarketWait = (
  check: PendingMarketCheck | undefined,
  finalizesAt: number,
): PendingMarketCheck => [finalizesAt, check?.[1] ?? 0];
