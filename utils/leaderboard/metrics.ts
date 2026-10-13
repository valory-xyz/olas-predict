/**
 * Pure window-metric calculations for the leaderboard.
 *
 * P&L follows the trader agent's own profit-over-time (`agent_performance_summary_abci`):
 * `dailyProfit` minus mech fees attributed by `_match_mech_requests_to_days`. Two deliberate
 * differences from the agent's Profile:
 * - Windows are N full UTC days ending today (see `getWindowStart`). The agent's
 *   `_filter_profit_data_by_window` effectively drops the first of those days, so its figure for
 *   the same period can differ.
 * - ROI divides P&L by the gross buy cost of the markets settled in the window plus mech fees
 *   (see `computeWindowMetrics`), not by the sources' settled cost, which is net of sells.
 */
import type { LeaderboardMetrics } from 'types/leaderboard';

export const SECONDS_PER_DAY = 86400;

/** One agent's statistics for one UTC day, amounts already converted to USD */
export type AgentDay = {
  /** UTC midnight, in seconds */
  date: number;
  /** Bets placed that day */
  bets: number;
  /** Amount traded that day */
  traded: number;
  /** Cost of the bets settled that day */
  tradedSettled: number;
  /** Fees of the bets settled that day (0 where the source has no fees) */
  feesSettled: number;
  /** Profit that landed that day */
  profit: number;
  /** Sum of the Brier scores of the bets settled that day, already scaled to 0..1 per bet */
  brierSum: number;
  /** Number of bets settled that day */
  brierCount: number;
  /** Markets whose result landed that day, by market id */
  markets: string[];
};

export type MechRequest = {
  /** Key of the request's question title, comparable with `MarketTitles` values */
  titleKey: string;
  /** Block timestamp, in seconds */
  timestamp: number;
};

/** Market id -> title key */
export type MarketTitles = Record<string, string>;

/**
 * Market id -> [won bets, counted bets, buy cost], only for markets with a final answer. The
 * buy cost is what the agent paid for its buys on the market, fees included, without sells.
 */
export type MarketTallies = Record<string, [number, number, number]>;

export type WindowMetrics = LeaderboardMetrics & {
  settledBets: number;
  /** ROI denominator: gross buy cost of the markets settled in the window, plus mech fees */
  settledCost: number;
};

export const getDayStart = (timestamp: number) =>
  Math.floor(timestamp / SECONDS_PER_DAY) * SECONDS_PER_DAY;

/**
 * Start of a window of `days` full UTC days that includes today: the UTC midnight
 * `days − 1` days before today's, comparable with the `date` keys of daily statistics. This
 * is intentionally not the trader's window rule, which leaves out the first of those days.
 */
export const getWindowStart = (nowSeconds: number, days: number) =>
  getDayStart(nowSeconds) - (days - 1) * SECONDS_PER_DAY;

/**
 * Number of mech requests charged to each day.
 *
 * A request whose question title belongs to a market settled for this agent lands on that
 * market's settlement day, if it was made before the end of that day. Every other request
 * lands on its own day, like the agent's unplaced requests, including one without a title
 * (an empty `titleKey`).
 */
export const attributeMechFees = (
  days: AgentDay[],
  requests: MechRequest[],
  marketTitles: MarketTitles,
): Map<number, number> => {
  const settlementDayByTitle = new Map<string, number>();
  days.forEach((day) => {
    day.markets.forEach((marketId) => {
      const titleKey = marketTitles[marketId];
      if (!titleKey) return;
      const known = settlementDayByTitle.get(titleKey);
      if (known === undefined || day.date > known) settlementDayByTitle.set(titleKey, day.date);
    });
  });

  const feesByDay = new Map<number, number>();
  requests.forEach(({ titleKey, timestamp }) => {
    const settlementDay = settlementDayByTitle.get(titleKey);
    const placed = settlementDay !== undefined && timestamp < settlementDay + SECONDS_PER_DAY;
    const day = placed ? settlementDay : getDayStart(timestamp);
    feesByDay.set(day, (feesByDay.get(day) ?? 0) + 1);
  });
  return feesByDay;
};

/**
 * The last day each market settled for the agent. A market can appear on more than one day
 * (e.g. when its answer changes after a first settlement); its bets are counted once, there.
 */
export const getLastSettlementDays = (days: AgentDay[]): Map<string, number> => {
  const lastDay = new Map<string, number>();
  days.forEach((day) =>
    day.markets.forEach((marketId) => {
      const known = lastDay.get(marketId);
      if (known === undefined || day.date > known) lastDay.set(marketId, day.date);
    }),
  );
  return lastDay;
};

/**
 * Metrics for the days from `windowStart` (inclusive) onwards.
 *
 * Mech fees charged to days without daily statistics (mech-only days) count too, so such a
 * day carries a negative P&L as on the agent's profit-over-time.
 */
export const computeWindowMetrics = ({
  days,
  feesByDay,
  tallies,
  windowStart,
  mechFee,
}: {
  days: AgentDay[];
  feesByDay: Map<number, number>;
  tallies: MarketTallies;
  windowStart: number;
  mechFee: number;
}): WindowMetrics => {
  let profit = 0;
  let buyCost = 0;
  let volume = 0;
  let trades = 0;
  let brierSum = 0;
  let brierCount = 0;
  let won = 0;
  let counted = 0;
  const lastSettlementDays = getLastSettlementDays(days);

  days.forEach((day) => {
    if (day.date < windowStart) return;
    profit += day.profit;
    volume += day.traded;
    trades += day.bets;
    brierSum += day.brierSum;
    brierCount += day.brierCount;
    let dayBuyCost = 0;
    // Buy cost of the day's markets that settle again later and are counted there instead
    let laterBuyCost = 0;
    let isDayBuyCostKnown = day.markets.length > 0;
    new Set(day.markets).forEach((marketId) => {
      const tally = tallies[marketId];
      if (lastSettlementDays.get(marketId) !== day.date) {
        laterBuyCost += tally?.[2] ?? 0;
        return;
      }
      if (!tally) {
        isDayBuyCostKnown = false;
        return;
      }
      won += tally[0];
      counted += tally[1];
      dayBuyCost += tally[2];
    });
    // Without every market's buy cost, fall back to the day's settled cost: it is net of sell
    // proceeds, so never more than the gross cost. It also holds the markets that settle again
    // on a later day, where their buy cost is added: take theirs out, so they are not counted
    // twice. Their net share of the day is unknown and at most their buy cost, so this keeps the
    // fallback a lower bound. An untallied market that settles again is counted in both days'
    // fallbacks (its share of either day is unknown); a later lookup that tallies it fixes that.
    const netSettled = day.tradedSettled + day.feesSettled - laterBuyCost;
    buyCost += isDayBuyCostKnown ? dayBuyCost : Math.max(dayBuyCost, netSettled, 0);
  });

  let mechRequests = 0;
  feesByDay.forEach((count, day) => {
    if (day >= windowStart) mechRequests += count;
  });
  const mechFees = mechRequests * mechFee;

  const pnl = profit - mechFees;
  // The sources' settled cost is net of sell proceeds, so it is tiny or negative for an agent
  // that sold before settlement, which would blow ROI up. ROI divides by the gross cost of the
  // buys instead (what the agent put at risk), counted once per market on its last settlement
  // day, plus mech fees.
  const settledCost = buyCost + mechFees;

  return {
    roi: settledCost > 0 ? pnl / settledCost : 0,
    pnl,
    accuracy: counted > 0 ? won / counted : null,
    brierScore: brierCount > 0 ? brierSum / brierCount : null,
    avgTradeSize: trades > 0 ? volume / trades : null,
    volume,
    trades,
    settledBets: brierCount,
    settledCost,
  };
};

/**
 * The stored tally of one agent on one market with a final answer, from its bets there and
 * `score` (`tallyOmenBets` or `tallyPolymarketBets`). `null` when no bets came back for a market
 * the agent settled on (indexer lag between entities, an id the filter missed): the market stays
 * untallied, so a later run looks it up again rather than store a zero buy cost for good.
 */
export const toMarketTally = (
  bets: { outcomeIndexes: number[]; buyCost: number } | undefined,
  score: (outcomeIndexes: number[]) => [number, number] | null,
): [number, number, number] | null => {
  if (!bets) return null;
  const tally = score(bets.outcomeIndexes);
  return tally && [...tally, bets.buyCost];
};

/**
 * Won/counted tally for one agent's bets on one Omen market, following the agent's
 * `_calculate_omen_accuracy`: only finalized, non-arbitrated, non-invalid answers count.
 * Returns `null` while the answer is not final, so the caller can retry later.
 */
export const tallyOmenBets = ({
  outcomeIndexes,
  currentAnswer,
  answerFinalizedTimestamp,
  isPendingArbitration,
  nowSeconds,
  invalidAnswerHex,
}: {
  outcomeIndexes: number[];
  currentAnswer: string | null;
  answerFinalizedTimestamp: number | null;
  isPendingArbitration: boolean;
  nowSeconds: number;
  invalidAnswerHex: string;
}): [number, number] | null => {
  if (currentAnswer === null || isPendingArbitration) return null;
  if (!answerFinalizedTimestamp || answerFinalizedTimestamp > nowSeconds) return null;
  if (currentAnswer.toLowerCase() === invalidAnswerHex.toLowerCase()) return [0, 0];
  const correct = Number(BigInt(currentAnswer));
  const won = outcomeIndexes.filter((index) => index === correct).length;
  return [won, outcomeIndexes.length];
};

/**
 * Won/counted tally for one agent's bets on one Polymarket question, following the agent's
 * `_calculate_polymarket_accuracy`: invalid resolutions (`winningIndex < 0`) do not count.
 * Returns `null` while the question is unresolved.
 */
export const tallyPolymarketBets = ({
  outcomeIndexes,
  winningIndex,
}: {
  outcomeIndexes: number[];
  winningIndex: number | null;
}): [number, number] | null => {
  if (winningIndex === null) return null;
  if (winningIndex < 0) return [0, 0];
  const won = outcomeIndexes.filter((index) => index === winningIndex).length;
  return [won, outcomeIndexes.length];
};
