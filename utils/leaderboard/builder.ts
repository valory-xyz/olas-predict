/**
 * Server-only leaderboard builder: brings one agent type's working state up to date and, once
 * every input is complete, computes the ranked snapshot. Called by the cron refresh route.
 */
import { AGENTS, AgentType, INVALID_ANSWER_HEX } from 'constants/index';
import {
  CHAIN_ID_BY_AGENT_TYPE,
  LEADERBOARD_SNAPSHOT_SCHEMA_VERSION,
  LEADERBOARD_WINDOWS,
  LEADERBOARD_WINDOW_DAYS,
  LeaderboardWindow,
  MECH_FEE_USD,
  MIN_SETTLED_BETS_PER_WINDOW,
} from 'constants/leaderboard';
import type { LeaderboardSnapshot, SnapshotAgent, SnapshotWindowEntry } from 'types/leaderboard';
import { generateAgentName } from 'utils/agentName';

import {
  AgentDay,
  MarketTallies,
  MarketTitles,
  SECONDS_PER_DAY,
  WindowMetrics,
  attributeMechFees,
  computeWindowMetrics,
  getWindowStart,
  tallyOmenBets,
  tallyPolymarketBets,
} from './metrics';
import { isPearlAgent } from './pearl';
import { RankCandidate, assignRanks, getNotRankedReason } from './ranking';
import type { BuilderState } from './snapshot';
import {
  fetchBetOutcomes,
  fetchDailyStatistics,
  fetchMechRequests,
  fetchOmenMarketAnswers,
  fetchPolymarketQuestions,
  fetchServiceMetadata,
  fetchTraderAgents,
  mapWithConcurrency,
  toTitleKey,
} from './sources';

/** Mech requests are kept from this long before the longest window, for markets open then */
const MECH_LOOKBACK_SECONDS = 30 * SECONDS_PER_DAY;
const SERVICE_METADATA_BATCH = 100;
const AGENT_CONCURRENCY = 8;

export type BuildResult = {
  state: BuilderState;
  /** `null` while the backfill is incomplete; the previous snapshot stays in place */
  snapshot: LeaderboardSnapshot | null;
};

const isPastDeadline = (deadline: number) => Date.now() >= deadline;

/**
 * Looks up the Pearl flag of services not seen before; `false` when time ran out. A service
 * whose metadata cannot be read is left without a flag, so it is treated as not Pearl in this
 * snapshot and looked up again on the next run.
 */
const updatePearlFlags = async (
  agentType: AgentType,
  state: BuilderState,
  serviceIds: string[],
  deadline: number,
) => {
  const unknown = serviceIds.filter((id) => state.pearl[id] === undefined);
  for (let i = 0; i < unknown.length; i += SERVICE_METADATA_BATCH) {
    if (isPastDeadline(deadline)) return false;
    const batch = unknown.slice(i, i + SERVICE_METADATA_BATCH);
    const metadata = await fetchServiceMetadata(agentType, batch);
    metadata.forEach((value, id) => {
      state.pearl[id] = isPearlAgent(value);
    });
  }
  return true;
};

/** Fetches each agent's new mech requests; `false` when time ran out */
const updateMechRequests = async (
  agentType: AgentType,
  state: BuilderState,
  agents: string[],
  keepFrom: number,
  deadline: number,
) => {
  const done = await mapWithConcurrency(agents, AGENT_CONCURRENCY, async (address) => {
    if (isPastDeadline(deadline)) return false;
    const entry = state.mech[address] ?? { syncedTo: keepFrom, requests: [] };
    const fetched = await fetchMechRequests(agentType, address, entry.syncedTo);
    const requests = entry.requests.filter(([, timestamp]) => timestamp >= keepFrom);
    fetched.forEach(({ title, timestamp }) => requests.push([toTitleKey(title), timestamp]));
    const syncedTo = fetched.reduce(
      (max, { timestamp }) => Math.max(max, timestamp),
      entry.syncedTo,
    );
    state.mech[address] = { syncedTo, requests };
    return true;
  });
  return done.every(Boolean);
};

/**
 * Tallies the agents' bets on markets that now have a final answer and were not tallied yet.
 * Markets without a final answer are retried on the next run. `false` when time ran out.
 */
const updateTallies = async (
  agentType: AgentType,
  state: BuilderState,
  marketsByAgent: Map<string, string[]>,
  nowSeconds: number,
  deadline: number,
) => {
  const pendingByAgent = new Map<string, string[]>();
  marketsByAgent.forEach((markets, address) => {
    const tallied = state.tallies[address] ?? {};
    const pending = markets.filter((marketId) => !tallied[marketId]);
    if (pending.length) pendingByAgent.set(address, pending);
  });
  const pendingMarkets = [...new Set([...pendingByAgent.values()].flat())];
  if (!pendingMarkets.length) return true;

  // Which pending markets have a final answer, and how to score a bet on each of them
  let scoreMarket: (marketId: string, outcomeIndexes: number[]) => [number, number] | null;
  if (agentType === AGENTS.OMENSTRAT) {
    const answers = await fetchOmenMarketAnswers(pendingMarkets);
    scoreMarket = (marketId, outcomeIndexes) => {
      const answer = answers.get(marketId);
      if (!answer) return null;
      return tallyOmenBets({
        ...answer,
        outcomeIndexes,
        nowSeconds,
        invalidAnswerHex: INVALID_ANSWER_HEX,
      });
    };
  } else {
    const questions = await fetchPolymarketQuestions(pendingMarkets);
    questions.forEach(({ title }, questionId) => {
      if (title) state.titles[questionId] = toTitleKey(title);
    });
    scoreMarket = (marketId, outcomeIndexes) => {
      const question = questions.get(marketId);
      if (!question) return null;
      return tallyPolymarketBets({ outcomeIndexes, winningIndex: question.winningIndex });
    };
  }
  const isFinal = (marketId: string) => scoreMarket(marketId, []) !== null;

  const done = await mapWithConcurrency(
    [...pendingByAgent.entries()],
    AGENT_CONCURRENCY,
    async ([address, pending]) => {
      if (isPastDeadline(deadline)) return false;
      const finalMarkets = pending.filter(isFinal);
      if (!finalMarkets.length) return true;
      const outcomes = await fetchBetOutcomes(agentType, address, finalMarkets);
      const tallied = (state.tallies[address] ??= {});
      finalMarkets.forEach((marketId) => {
        const tally = scoreMarket(marketId, outcomes.get(marketId) ?? []);
        if (tally) tallied[marketId] = tally;
      });
      return true;
    },
  );
  return done.every(Boolean);
};

/** Titles of Polymarket questions not seen before; `false` when time ran out */
const updatePolymarketTitles = async (
  state: BuilderState,
  questionIds: string[],
  deadline: number,
) => {
  const missing = questionIds.filter((id) => !state.titles[id]);
  if (!missing.length) return true;
  if (isPastDeadline(deadline)) return false;
  const questions = await fetchPolymarketQuestions(missing);
  questions.forEach(({ title }, questionId) => {
    if (title) state.titles[questionId] = toTitleKey(title);
  });
  return true;
};

/** Drops working state that no longer matters for the 1Y window */
const pruneState = (
  state: BuilderState,
  marketsByAgent: Map<string, string[]>,
  pearlAgents: string[],
) => {
  const pearlSet = new Set(pearlAgents);
  Object.keys(state.mech).forEach((address) => {
    if (!pearlSet.has(address)) delete state.mech[address];
  });
  Object.keys(state.tallies).forEach((address) => {
    const markets = new Set(marketsByAgent.get(address) ?? []);
    const tallied = state.tallies[address];
    Object.keys(tallied).forEach((marketId) => {
      if (!markets.has(marketId)) delete tallied[marketId];
    });
    if (!pearlSet.has(address) || !Object.keys(tallied).length) delete state.tallies[address];
  });
  const liveMarkets = new Set([...marketsByAgent.values()].flat());
  Object.keys(state.titles).forEach((marketId) => {
    if (!liveMarkets.has(marketId)) delete state.titles[marketId];
  });
};

type AgentInputs = {
  address: string;
  serviceId: string;
  days: AgentDay[];
  requests: [string, number][];
  tallies: MarketTallies;
};

/** Ranks agents in every window and assembles the snapshot */
export const computeSnapshot = ({
  agentType,
  agents,
  marketTitles,
  nowSeconds,
  sourceHeight,
}: {
  agentType: AgentType;
  agents: AgentInputs[];
  marketTitles: MarketTitles;
  nowSeconds: number;
  sourceHeight: number | null;
}): LeaderboardSnapshot => {
  const chainId = CHAIN_ID_BY_AGENT_TYPE[agentType];

  const prepared = agents.map((agent) => {
    const feesByDay = attributeMechFees(
      agent.days,
      agent.requests.map(([titleKey, timestamp]) => ({ titleKey, timestamp })),
      marketTitles,
    );
    const hasSettledActivity = agent.days.some(
      (day) => day.brierCount > 0 || day.tradedSettled > 0,
    );
    const metrics = Object.fromEntries(
      LEADERBOARD_WINDOWS.map((window) => [
        window,
        computeWindowMetrics({
          days: agent.days,
          feesByDay,
          tallies: agent.tallies,
          windowStart: getWindowStart(nowSeconds, LEADERBOARD_WINDOW_DAYS[window]),
          mechFee: MECH_FEE_USD,
        }),
      ]),
    ) as Record<LeaderboardWindow, WindowMetrics>;
    return { ...agent, hasSettledActivity, metrics };
  });

  const windows = LEADERBOARD_WINDOWS.map((window) => {
    const candidates: RankCandidate[] = prepared.map((agent) => ({
      address: agent.address,
      metrics: agent.metrics[window],
      hasSettledActivity: agent.hasSettledActivity,
    }));
    const reasons = new Map(
      candidates.map((c) => [c.address, getNotRankedReason(c, MIN_SETTLED_BETS_PER_WINDOW)]),
    );
    const eligible = candidates.filter((c) => reasons.get(c.address) === null);
    return {
      window,
      reasons,
      totalRanked: eligible.length,
      roiRanks: assignRanks(eligible, 'roi'),
      pnlRanks: assignRanks(eligible, 'pnl'),
    };
  });

  const snapshotAgents: SnapshotAgent[] = prepared.map((agent) => ({
    address: agent.address,
    serviceId: agent.serviceId,
    name: generateAgentName(chainId, BigInt(agent.serviceId)),
    hasSettledActivity: agent.hasSettledActivity,
    windows: Object.fromEntries(
      windows.map(({ window, reasons, roiRanks, pnlRanks }) => {
        const notRankedReason = reasons.get(agent.address) ?? null;
        const { roi, pnl, accuracy, brierScore, avgTradeSize, volume, trades } =
          agent.metrics[window];
        const metrics = { roi, pnl, accuracy, brierScore, avgTradeSize, volume, trades };
        const entry: SnapshotWindowEntry = {
          metrics: notRankedReason ? null : metrics,
          rankByRoi: roiRanks.get(agent.address) ?? null,
          rankByPnl: pnlRanks.get(agent.address) ?? null,
          notRankedReason,
        };
        return [window, entry];
      }),
    ) as Record<LeaderboardWindow, SnapshotWindowEntry>,
  }));

  return {
    schemaVersion: LEADERBOARD_SNAPSHOT_SCHEMA_VERSION,
    agentType,
    updatedAt: new Date(nowSeconds * 1000).toISOString(),
    sourceHeight,
    totalRanked: Object.fromEntries(windows.map((w) => [w.window, w.totalRanked])) as Record<
      LeaderboardWindow,
      number
    >,
    agents: snapshotAgents,
  };
};

/**
 * Brings the working state up to date and builds the snapshot. Stops early, keeping what it
 * fetched, once `deadline` (epoch ms) passes; the next run resumes from the saved state.
 */
export const buildLeaderboard = async (
  agentType: AgentType,
  state: BuilderState,
  deadline: number,
): Promise<BuildResult> => {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const yearStart = getWindowStart(nowSeconds, LEADERBOARD_WINDOW_DAYS['1y']);

  const population = await fetchTraderAgents(agentType);
  const statistics = await fetchDailyStatistics(agentType, yearStart, nowSeconds);

  // Only agents with activity in the longest window can appear on the leaderboard
  const activeAgents = population.agents.filter(({ address }) =>
    statistics.daysByAgent.has(address),
  );
  const pearlFlagsComplete = await updatePearlFlags(
    agentType,
    state,
    [...new Set(activeAgents.map(({ serviceId }) => serviceId))],
    deadline,
  );
  const pearlAgents = activeAgents.filter(({ serviceId }) => state.pearl[serviceId]);
  const pearlAddresses = pearlAgents.map(({ address }) => address);

  const marketsByAgent = new Map(
    pearlAddresses.map((address) => [
      address,
      [...new Set((statistics.daysByAgent.get(address) ?? []).flatMap((day) => day.markets))],
    ]),
  );

  const titlesComplete =
    agentType === AGENTS.POLYSTRAT
      ? await updatePolymarketTitles(
          state,
          [...new Set([...marketsByAgent.values()].flat())],
          deadline,
        )
      : true;
  const talliesComplete = await updateTallies(
    agentType,
    state,
    marketsByAgent,
    nowSeconds,
    deadline,
  );
  const mechComplete = await updateMechRequests(
    agentType,
    state,
    pearlAddresses,
    yearStart - MECH_LOOKBACK_SECONDS,
    deadline,
  );

  pruneState(state, marketsByAgent, pearlAddresses);

  if (!pearlFlagsComplete || !titlesComplete || !talliesComplete || !mechComplete) {
    return { state, snapshot: null };
  }

  const marketTitles: MarketTitles =
    agentType === AGENTS.OMENSTRAT
      ? Object.fromEntries(
          Object.entries(statistics.omenTitles).map(([id, title]) => [id, toTitleKey(title)]),
        )
      : state.titles;

  const snapshot = computeSnapshot({
    agentType,
    nowSeconds,
    sourceHeight: population.sourceHeight,
    marketTitles,
    agents: pearlAgents.map(({ address, serviceId }) => ({
      address,
      serviceId,
      days: statistics.daysByAgent.get(address) ?? [],
      requests: state.mech[address]?.requests ?? [],
      tallies: state.tallies[address] ?? {},
    })),
  });
  return { state, snapshot };
};
