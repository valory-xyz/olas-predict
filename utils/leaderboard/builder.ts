/**
 * Server-only leaderboard builder: brings one agent type's working state up to date and, once
 * every input is complete, computes the ranked snapshot. Called by the cron refresh route.
 */
import { AGENTS, type AgentType, INVALID_ANSWER_HEX } from 'constants/index';
import { LEADERBOARD_WINDOW_DAYS } from 'constants/leaderboard';
import type { LeaderboardSnapshot } from 'types/leaderboard';

import { computeSnapshot } from './compute';
import {
  type MarketTitles,
  SECONDS_PER_DAY,
  getWindowStart,
  tallyOmenBets,
  tallyPolymarketBets,
  toMarketTally,
} from './metrics';
import {
  classifyService,
  isPearlLookupPending,
  isPearlLookupUnresolved,
  needsPearlLookup,
  recordPearlLookup,
} from './pearl';
import { needsMarketCheck, recordMarketMiss, recordMarketWait } from './pending';
import type { BuilderState } from './snapshot';
import {
  DeadlineError,
  type Lookup,
  type PolymarketQuestion,
  fetchDailyStatistics,
  fetchMarketBets,
  fetchMechRequests,
  fetchOmenMarketAnswers,
  fetchPolymarketQuestions,
  fetchServiceMetadata,
  fetchTokenUris,
  fetchTraderAgents,
  mapWithConcurrency,
  toTitleKey,
} from './sources';

/** Mech requests are kept from this long before the longest window, for markets open then */
const MECH_LOOKBACK_SECONDS = 30 * SECONDS_PER_DAY;
const AGENT_CONCURRENCY = 8;
/** How far back each run re-reads an agent's mech requests (see `updateMechRequests`) */
export const MECH_REFETCH_OVERLAP_SECONDS = SECONDS_PER_DAY;

export type BuildResult = {
  state: BuilderState;
  /** `null` while the backfill is incomplete; the previous snapshot stays in place */
  snapshot: LeaderboardSnapshot | null;
  /** Active services whose Pearl flag could not be read, left out of the snapshot */
  unresolvedServices: string[];
};

const isPastDeadline = (deadline: number) => Date.now() >= deadline;

/**
 * Looks up the Pearl flag of the services that need it (see `needsPearlLookup`): each run reads
 * every active service's tokenURI (one multicall per 50) and fetches the metadata of new
 * services and of those whose URI changed. `false` while a service's flag is still pending,
 * i.e. a lookup failed fewer than `PEARL_LOOKUP_MAX_FAILURES` runs in a row or was not made
 * (time ran out, RPC or gateway down), so the snapshot waits rather than leave a Pearl agent
 * out. Infrastructure failures do not count as failed lookups.
 */
const updatePearlFlags = async (
  agentType: AgentType,
  state: BuilderState,
  serviceIds: string[],
  deadline: number,
) => {
  const now = Date.now();
  const { uris, failed: unreadable } = await fetchTokenUris(agentType, serviceIds, deadline);
  const toLookUp = serviceIds.filter(
    (id) => uris.has(id) && needsPearlLookup(state.pearl[id], now, uris.get(id)),
  );
  const { metadata, failed } = await fetchServiceMetadata(
    toLookUp.map((id) => [id, uris.get(id) as string]),
    deadline,
  );
  metadata.forEach((value, id) => {
    state.pearl[id] = recordPearlLookup(
      state.pearl[id],
      classifyService(agentType, value),
      now,
      uris.get(id),
    );
  });
  [...unreadable.filter((id) => needsPearlLookup(state.pearl[id], now)), ...failed].forEach(
    (id) => {
      state.pearl[id] = recordPearlLookup(state.pearl[id], null, now);
    },
  );
  return serviceIds.every((id) => !isPearlLookupPending(state.pearl[id]));
};

/**
 * Fetches each agent's new mech requests; `false` when time ran out or a fetch failed. Each run
 * re-reads the requests from `MECH_REFETCH_OVERLAP_SECONDS` before the newest one stored and
 * replaces the stored ones from there: mech-analytics ingests requests with a delay (and only
 * once their payload is parsed), so the newest stored request is not a safe cursor on its own.
 * An agent cut short by the deadline keeps the requests fetched so far and resumes from them; a
 * failed fetch leaves the agent's stored requests as they were.
 */
const updateMechRequests = async (
  agentType: AgentType,
  state: BuilderState,
  agents: string[],
  keepFrom: number,
  deadline: number,
) => {
  const done = await mapWithConcurrency(agents, AGENT_CONCURRENCY, async (address) => {
    if (isPastDeadline(deadline)) return false;
    const entry = state.mech[address];
    const refetchFrom = entry
      ? Math.max(keepFrom, entry.syncedTo - MECH_REFETCH_OVERLAP_SECONDS)
      : keepFrom;
    let fetched;
    try {
      fetched = await fetchMechRequests(agentType, address, refetchFrom, deadline);
    } catch (error) {
      console.error(`Leaderboard: ${agentType} mech requests of ${address} unavailable`, error);
      return false;
    }
    if (!fetched.complete && !fetched.requests.length) return false;
    const requests = (entry?.requests ?? []).filter(
      ([, timestamp]) => timestamp >= keepFrom && timestamp < refetchFrom,
    );
    let newest = fetched.complete ? (entry?.syncedTo ?? keepFrom) : refetchFrom;
    // A request without a question title cannot be matched to a market; an empty key charges
    // it to its own day
    fetched.requests.forEach(({ title, timestamp }) => {
      requests.push([title ? toTitleKey(title) : '', timestamp]);
      newest = Math.max(newest, timestamp);
    });
    state.mech[address] = { syncedTo: newest, requests };
    return fetched.complete;
  });
  return done.every(Boolean);
};

/**
 * Tallies the agents' bets on markets that now have a final answer and were not tallied yet.
 * Markets left untallied are looked up again when due (see `pending.ts`): an Omen market that
 * only waits out its answer timeout at its finalization time, any other with a growing interval. `prefetched` holds Polymarket questions this run
 * already read, which are scored without another lookup. `false` when time ran out.
 */
const updateTallies = async (
  agentType: AgentType,
  state: BuilderState,
  marketsByAgent: Map<string, string[]>,
  nowSeconds: number,
  deadline: number,
  prefetched?: Lookup<PolymarketQuestion>,
) => {
  const now = Date.now();
  const checks = (state.pendingMarkets ??= {});
  const prefetchedIds = new Set(prefetched?.checked);
  const pendingByAgent = new Map<string, string[]>();
  marketsByAgent.forEach((markets, address) => {
    const tallied = state.tallies[address] ?? {};
    const pending = markets.filter(
      (marketId) =>
        !tallied[marketId] &&
        (prefetchedIds.has(marketId) || needsMarketCheck(checks[marketId], now)),
    );
    if (pending.length) pendingByAgent.set(address, pending);
  });
  const pendingMarkets = [...new Set([...pendingByAgent.values()].flat())];
  if (!pendingMarkets.length) return true;

  // Which pending markets have a final answer, and how to score a bet on each of them
  let scoreMarket: (marketId: string, outcomeIndexes: number[]) => [number, number] | null;
  // When a market that is not final yet will be, if that is known (epoch ms)
  let finalizesAt: (marketId: string) => number | null = () => null;
  let checked: string[];
  if (agentType === AGENTS.OMENSTRAT) {
    const { found: answers, checked: checkedMarkets } = await fetchOmenMarketAnswers(
      pendingMarkets,
      deadline,
    );
    checked = checkedMarkets;
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
    finalizesAt = (marketId) => {
      const answer = answers.get(marketId);
      return answer &&
        answer.currentAnswer !== null &&
        !answer.isPendingArbitration &&
        answer.answerFinalizedTimestamp !== null &&
        answer.answerFinalizedTimestamp > nowSeconds
        ? answer.answerFinalizedTimestamp * 1000
        : null;
    };
  } else {
    const fetched = await fetchPolymarketQuestions(
      pendingMarkets.filter((id) => !prefetchedIds.has(id)),
      deadline,
    );
    const questions = new Map([...(prefetched?.found ?? []), ...fetched.found]);
    checked = [...pendingMarkets.filter((id) => prefetchedIds.has(id)), ...fetched.checked];
    questions.forEach(({ title }, questionId) => {
      if (title) state.titles[questionId] = toTitleKey(title);
    });
    scoreMarket = (marketId, outcomeIndexes) => {
      const question = questions.get(marketId);
      if (!question) return null;
      return tallyPolymarketBets({ outcomeIndexes, winningIndex: question.winningIndex });
    };
  }
  const checkedSet = new Set(checked);
  const isFinal = (marketId: string) =>
    checkedSet.has(marketId) && scoreMarket(marketId, []) !== null;
  // Looked up this run and still untallied for some agent
  const missed = new Set<string>();

  const done = await mapWithConcurrency(
    [...pendingByAgent.entries()],
    AGENT_CONCURRENCY,
    async ([address, pending]) => {
      if (isPastDeadline(deadline)) return false;
      pending
        .filter((marketId) => checkedSet.has(marketId) && !isFinal(marketId))
        .forEach((marketId) => missed.add(marketId));
      const finalMarkets = pending.filter(isFinal);
      if (!finalMarkets.length) return true;
      const { bets, fetchedMarkets } = await fetchMarketBets(
        agentType,
        address,
        finalMarkets,
        deadline,
      );
      const tallied = (state.tallies[address] ??= {});
      fetchedMarkets.forEach((marketId) => {
        const tally = toMarketTally(bets.get(marketId), (outcomeIndexes) =>
          scoreMarket(marketId, outcomeIndexes),
        );
        if (tally) tallied[marketId] = tally;
        else missed.add(marketId);
      });
      return fetchedMarkets.length === finalMarkets.length;
    },
  );
  checked.forEach((marketId) => {
    if (!missed.has(marketId)) {
      delete checks[marketId];
      return;
    }
    const waitUntil = finalizesAt(marketId);
    checks[marketId] =
      waitUntil === null
        ? recordMarketMiss(checks[marketId], now)
        : recordMarketWait(checks[marketId], waitUntil);
  });
  return checked.length === pendingMarkets.length && done.every(Boolean);
};

/**
 * Titles of Polymarket questions not seen before; `complete` is `false` when time ran out.
 * Also returns the lookup, so the tallies can reuse it.
 */
const updatePolymarketTitles = async (
  state: BuilderState,
  questionIds: string[],
  deadline: number,
) => {
  const missing = questionIds.filter((id) => !state.titles[id]);
  const lookup: Lookup<PolymarketQuestion> = missing.length
    ? await fetchPolymarketQuestions(missing, deadline)
    : { found: new Map(), checked: [] };
  lookup.found.forEach(({ title }, questionId) => {
    if (title) state.titles[questionId] = toTitleKey(title);
  });
  return { complete: lookup.checked.length === missing.length, lookup };
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
  const pendingMarkets = state.pendingMarkets ?? {};
  Object.keys(pendingMarkets).forEach((marketId) => {
    if (!liveMarkets.has(marketId)) delete pendingMarkets[marketId];
  });
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

  let population;
  let statistics;
  try {
    population = await fetchTraderAgents(agentType, deadline);
    statistics = await fetchDailyStatistics(agentType, yearStart, nowSeconds, deadline);
  } catch (error) {
    // Nothing was fetched into the state yet: the next run starts over
    if (error instanceof DeadlineError) return { state, snapshot: null, unresolvedServices: [] };
    throw error;
  }

  // Only agents with activity in the longest window can appear on the leaderboard
  const activeAgents = population.agents.filter(({ address }) =>
    statistics.daysByAgent.has(address),
  );
  const activeServices = [...new Set(activeAgents.map(({ serviceId }) => serviceId))];
  const pearlFlagsComplete = await updatePearlFlags(agentType, state, activeServices, deadline);
  const unresolvedServices = activeServices.filter((id) =>
    isPearlLookupUnresolved(state.pearl[id]),
  );
  const pearlAgents = activeAgents.filter(
    ({ serviceId }) => state.pearl[serviceId]?.status === 'pearl',
  );
  const pearlAddresses = pearlAgents.map(({ address }) => address);

  const marketsByAgent = new Map(
    pearlAddresses.map((address) => [
      address,
      [...new Set((statistics.daysByAgent.get(address) ?? []).flatMap((day) => day.markets))],
    ]),
  );

  const titles =
    agentType === AGENTS.POLYSTRAT
      ? await updatePolymarketTitles(
          state,
          [...new Set([...marketsByAgent.values()].flat())],
          deadline,
        )
      : null;
  const titlesComplete = titles?.complete ?? true;
  const talliesComplete = await updateTallies(
    agentType,
    state,
    marketsByAgent,
    nowSeconds,
    deadline,
    titles?.lookup,
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
    return { state, snapshot: null, unresolvedServices };
  }

  const marketTitles: MarketTitles =
    agentType === AGENTS.OMENSTRAT
      ? Object.fromEntries(
          Object.entries(statistics.omenTitles)
            .filter(([, title]) => title)
            .map(([id, title]) => [id, toTitleKey(title)]),
        )
      : state.titles;

  const snapshot = computeSnapshot({
    agentType,
    nowSeconds,
    sourceHeight: population.sourceHeight,
    marketTitles,
    // Known not to be Pearl agents; a service whose lookup gave up stays unknown
    excluded: activeAgents
      .filter(({ serviceId }) => {
        const status = state.pearl[serviceId]?.status;
        return status === 'other' || status === 'malformed';
      })
      .map(({ address }) => address),
    agents: pearlAgents.map(({ address, serviceId }) => ({
      address,
      serviceId,
      days: statistics.daysByAgent.get(address) ?? [],
      requests: state.mech[address]?.requests ?? [],
      tallies: state.tallies[address] ?? {},
    })),
  });
  return { state, snapshot, unresolvedServices };
};
