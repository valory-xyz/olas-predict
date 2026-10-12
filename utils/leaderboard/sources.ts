/**
 * Server-only fetchers for the leaderboard builder. Each returns plain, normalized data; the
 * builder (`builder.ts`) decides what to fetch and what to keep.
 */
import { type Variables, request } from 'graphql-request';
import {
  leaderboardMechRequestsQuery,
  leaderboardOmenBetsQuery,
  leaderboardOmenDailyStatisticsQuery,
  leaderboardOmenFinalizationQuery,
  leaderboardOmenTraderAgentsQuery,
  leaderboardPolymarketBetsQuery,
  leaderboardPolymarketDailyStatisticsQuery,
  leaderboardPolymarketQuestionsQuery,
  leaderboardPolymarketTraderAgentsQuery,
} from 'graphql/queries';
import { createPublicClient, http, parseAbi } from 'viem';
import { polygon } from 'viem/chains';

import {
  AGENTS,
  AgentType,
  OLAS_MECH_POLYGON_SUBGRAPH_URL,
  OLAS_MECH_SUBGRAPH_URL,
  OMEN_SUBGRAPH_URL,
  POLYMARKET_SQUID_URL,
  PREDICT_OMEN_SUBGRAPH_URL,
} from 'constants/index';
import {
  CHAIN_ID_BY_AGENT_TYPE,
  QUESTION_DATA_SEPARATOR,
  SERVICE_REGISTRY_ADDRESSES,
  TOKEN_DECIMALS,
} from 'constants/leaderboard';
import { publicClient } from 'constants/viemConfig';

import type { AgentDay } from './metrics';
import { SECONDS_PER_DAY } from './metrics';

const PAGE_SIZE = 1000;
/** `id_in` / `_in` filters are chunked to stay well inside the indexers' limits */
const IN_FILTER_CHUNK = 500;
const BRIER_SCALE = 1e18;
const METADATA_FETCH_TIMEOUT_MS = 10_000;
/** Services whose metadata is read per batch, between deadline checks */
const SERVICE_METADATA_BATCH = 25;
/**
 * Longest wait for one GraphQL response. Well inside the refresh route's save margin, so a
 * hung indexer cannot keep the function from saving its working state.
 */
const GRAPHQL_TIMEOUT_MS = 30_000;
/** Days of daily statistics fetched per concurrent Omen page stream */
const OMEN_DAILY_STATS_DAYS_PER_STREAM = 30;

const gqlRequest = <T>(url: string, document: string, variables: Variables) =>
  request<T>({ url, document, variables, signal: AbortSignal.timeout(GRAPHQL_TIMEOUT_MS) });

export const chunk = <T>(items: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
};

/** Runs `fn` over `items` with at most `concurrency` calls in flight, keeping order */
export const mapWithConcurrency = async <T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> => {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
};

/** Divides a token amount given as a decimal string by 10^decimals, keeping precision */
const toUnits = (amount: string | number | null | undefined, decimals: number) => {
  if (amount === null || amount === undefined) return 0;
  const value = BigInt(amount);
  const divisor = BigInt(`1${'0'.repeat(decimals)}`);
  const whole = value / divisor;
  const fraction = value % divisor;
  return Number(whole) + Number(fraction) / Number(divisor);
};

/** Short, stable key for a question title, so the working state stores no full titles */
export const toTitleKey = (title: string) => {
  // cyrb53: a fast 53-bit string hash; collisions between real titles are negligible
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < title.length; i++) {
    const ch = title.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
};

export const getOmenQuestionTitle = (question: string | null | undefined) =>
  question ? question.split(QUESTION_DATA_SEPARATOR)[0] : '';

export type TraderAgentRecord = { address: string; serviceId: string };

export type AgentPopulation = {
  agents: TraderAgentRecord[];
  sourceHeight: number | null;
};

export const fetchTraderAgents = async (agentType: AgentType): Promise<AgentPopulation> => {
  const agents: TraderAgentRecord[] = [];
  let sourceHeight: number | null = null;

  if (agentType === AGENTS.OMENSTRAT) {
    let idGt = '0x';
    for (;;) {
      const page = await gqlRequest<{
        traderAgents: { id: string; serviceId: string }[];
        _meta: { block: { number: number } };
      }>(PREDICT_OMEN_SUBGRAPH_URL, leaderboardOmenTraderAgentsQuery, { idGt });
      sourceHeight ??= page._meta.block.number;
      page.traderAgents.forEach(({ id, serviceId }) =>
        agents.push({ address: id.toLowerCase(), serviceId }),
      );
      if (page.traderAgents.length < PAGE_SIZE) break;
      idGt = page.traderAgents[page.traderAgents.length - 1].id;
    }
    return { agents, sourceHeight };
  }

  let idGt = '';
  for (;;) {
    const page = await gqlRequest<{
      traderAgents: { id: string; serviceId: string }[];
      squidStatus: { height: number };
    }>(POLYMARKET_SQUID_URL, leaderboardPolymarketTraderAgentsQuery, { idGt });
    sourceHeight ??= page.squidStatus.height;
    page.traderAgents.forEach(({ id, serviceId }) =>
      agents.push({ address: id.toLowerCase(), serviceId }),
    );
    if (page.traderAgents.length < PAGE_SIZE) break;
    idGt = page.traderAgents[page.traderAgents.length - 1].id;
  }
  return { agents, sourceHeight };
};

export type DailyStatistics = {
  daysByAgent: Map<string, AgentDay[]>;
  /** Market id -> question title, for the Omen markets seen in the statistics */
  omenTitles: Record<string, string>;
};

type OmenDailyStatisticRow = {
  id: string;
  date: string;
  traderAgent: { id: string };
  totalBets: number;
  totalTraded: string;
  dailyTradedSettled: string;
  dailyFeesSettled: string;
  dailyProfit: string;
  brierSum: string;
  brierCount: number;
  profitParticipants: { id: string; question: string | null }[];
};

type PolymarketDailyStatisticRow = {
  id: string;
  date: string;
  traderAgentId: string;
  totalBets: number;
  totalTraded: string;
  dailyTradedSettled: string;
  dailyProfit: string;
  brierSum: string;
  brierCount: number;
  profitParticipants: string[];
};

const pushDay = (daysByAgent: Map<string, AgentDay[]>, address: string, day: AgentDay) => {
  const days = daysByAgent.get(address);
  if (days) days.push(day);
  else daysByAgent.set(address, [day]);
};

/** Every agent's daily statistics from `dateGte` (UTC midnight, seconds) onwards */
export const fetchDailyStatistics = async (
  agentType: AgentType,
  dateGte: number,
  nowSeconds: number,
): Promise<DailyStatistics> => {
  const decimals = TOKEN_DECIMALS[agentType];
  const daysByAgent = new Map<string, AgentDay[]>();
  const omenTitles: Record<string, string> = {};

  if (agentType === AGENTS.OMENSTRAT) {
    // Split the range into streams of days so the pages can be fetched concurrently
    const ranges: [number, number][] = [];
    const end = nowSeconds + SECONDS_PER_DAY;
    for (
      let start = dateGte;
      start < end;
      start += OMEN_DAILY_STATS_DAYS_PER_STREAM * SECONDS_PER_DAY
    ) {
      ranges.push([
        start,
        Math.min(start + OMEN_DAILY_STATS_DAYS_PER_STREAM * SECONDS_PER_DAY, end),
      ]);
    }
    const streams = await mapWithConcurrency(ranges, 6, async ([from, to]) => {
      const rows: OmenDailyStatisticRow[] = [];
      let idGt = '';
      for (;;) {
        const page = await gqlRequest<{ dailyProfitStatistics: OmenDailyStatisticRow[] }>(
          PREDICT_OMEN_SUBGRAPH_URL,
          leaderboardOmenDailyStatisticsQuery,
          { dateGte: String(from), dateLt: String(to), idGt },
        );
        rows.push(...page.dailyProfitStatistics);
        if (page.dailyProfitStatistics.length < PAGE_SIZE) break;
        idGt = page.dailyProfitStatistics[page.dailyProfitStatistics.length - 1].id;
      }
      return rows;
    });

    streams.flat().forEach((row) => {
      row.profitParticipants.forEach(({ id, question }) => {
        omenTitles[id.toLowerCase()] = getOmenQuestionTitle(question);
      });
      pushDay(daysByAgent, row.traderAgent.id.toLowerCase(), {
        date: Number(row.date),
        bets: row.totalBets,
        traded: toUnits(row.totalTraded, decimals),
        tradedSettled: toUnits(row.dailyTradedSettled, decimals),
        feesSettled: toUnits(row.dailyFeesSettled, decimals),
        profit: toUnits(row.dailyProfit, decimals),
        brierSum: Number(row.brierSum) / BRIER_SCALE,
        brierCount: row.brierCount,
        markets: row.profitParticipants.map(({ id }) => id.toLowerCase()),
      });
    });
    return { daysByAgent, omenTitles };
  }

  let idGt = '';
  for (;;) {
    const page = await gqlRequest<{ dailyProfitStatistics: PolymarketDailyStatisticRow[] }>(
      POLYMARKET_SQUID_URL,
      leaderboardPolymarketDailyStatisticsQuery,
      { dateGte: String(dateGte), idGt },
    );
    page.dailyProfitStatistics.forEach((row) => {
      pushDay(daysByAgent, row.traderAgentId.toLowerCase(), {
        date: Number(row.date),
        bets: row.totalBets,
        traded: toUnits(row.totalTraded, decimals),
        tradedSettled: toUnits(row.dailyTradedSettled, decimals),
        // The squid indexes no fees
        feesSettled: 0,
        profit: toUnits(row.dailyProfit, decimals),
        brierSum: Number(row.brierSum) / BRIER_SCALE,
        brierCount: row.brierCount,
        markets: (row.profitParticipants ?? []).map((id) => id.toLowerCase()),
      });
    });
    if (page.dailyProfitStatistics.length < PAGE_SIZE) break;
    idGt = page.dailyProfitStatistics[page.dailyProfitStatistics.length - 1].id;
  }
  return { daysByAgent, omenTitles };
};

const tokenUriAbi = parseAbi(['function tokenURI(uint256 unitId) view returns (string)']);

const publicClients = {
  100: publicClient,
  // viem's default Polygon RPC (polygon-rpc.com) now rejects unauthenticated calls
  137: createPublicClient({
    chain: polygon,
    transport: http(process.env.POLYGON_RPC_URL || 'https://polygon-bor-rpc.publicnode.com'),
  }),
} as const;

const fetchJsonWithTimeout = async (url: string, timeoutMs: number): Promise<unknown> => {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.json();
};

const toGatewayUrl = (uri: string) =>
  uri.startsWith('ipfs://') ? `https://gateway.autonolas.tech/ipfs/${uri.slice(7)}` : uri;

/**
 * Service metadata (the JSON behind `ServiceRegistry.tokenURI`) by service id, and the ids
 * whose tokenURI or metadata could not be read. Stops at `deadline` (epoch ms): the services
 * not reached by then are in neither, and each metadata read is cut short at the deadline.
 */
export const fetchServiceMetadata = async (
  agentType: AgentType,
  serviceIds: string[],
  deadline: number,
): Promise<{ metadata: Map<string, unknown>; failed: string[] }> => {
  const chainId = CHAIN_ID_BY_AGENT_TYPE[agentType] as keyof typeof publicClients;
  const client = publicClients[chainId];
  const metadata = new Map<string, unknown>();
  const failed: string[] = [];

  for (const ids of chunk(serviceIds, SERVICE_METADATA_BATCH)) {
    if (Date.now() >= deadline) break;
    const uris = await client.multicall({
      contracts: ids.map((id) => ({
        address: SERVICE_REGISTRY_ADDRESSES[chainId],
        abi: tokenUriAbi,
        functionName: 'tokenURI' as const,
        args: [BigInt(id)] as const,
      })),
      allowFailure: true,
    });
    await mapWithConcurrency(ids, 10, async (id) => {
      const uri = uris[ids.indexOf(id)];
      if (uri.status !== 'success') {
        console.error(`Leaderboard: tokenURI of service ${id} unavailable`, uri.error);
        failed.push(id);
        return;
      }
      const timeoutMs = Math.min(METADATA_FETCH_TIMEOUT_MS, deadline - Date.now());
      // Out of time: not attempted, so not a failure
      if (timeoutMs <= 0) return;
      try {
        metadata.set(id, await fetchJsonWithTimeout(toGatewayUrl(uri.result), timeoutMs));
      } catch (error) {
        // Cut short by the deadline rather than the full timeout: not a failure either
        if (timeoutMs < METADATA_FETCH_TIMEOUT_MS && Date.now() >= deadline) return;
        console.error(`Leaderboard: metadata of service ${id} unavailable`, error);
        failed.push(id);
      }
    });
  }
  return { metadata, failed };
};

/** `title` is `null` for a request whose question title could not be parsed */
export type MechRequestRecord = { title: string | null; timestamp: number };

/** The agent's mech requests after `timestampGt`, oldest first */
export const fetchMechRequests = async (
  agentType: AgentType,
  sender: string,
  timestampGt: number,
): Promise<MechRequestRecord[]> => {
  const url =
    agentType === AGENTS.OMENSTRAT ? OLAS_MECH_SUBGRAPH_URL : OLAS_MECH_POLYGON_SUBGRAPH_URL;
  const requests: MechRequestRecord[] = [];
  for (let skip = 0; ; skip += PAGE_SIZE) {
    const page = await gqlRequest<{
      requests: {
        blockTimestamp: string;
        parsedRequest: { questionTitle: string | null } | null;
      }[];
    }>(url, leaderboardMechRequestsQuery, {
      sender,
      timestampGt: String(timestampGt),
      skip,
    });
    page.requests.forEach(({ blockTimestamp, parsedRequest }) => {
      // Every request is paid for, even one whose question could not be parsed
      requests.push({
        title: parsedRequest?.questionTitle || null,
        timestamp: Number(blockTimestamp),
      });
    });
    if (page.requests.length < PAGE_SIZE) break;
  }
  return requests;
};

export type OmenMarketAnswer = {
  currentAnswer: string | null;
  answerFinalizedTimestamp: number | null;
  isPendingArbitration: boolean;
};

/** Answer and finalization of Omen markets, from the Omen subgraph */
export const fetchOmenMarketAnswers = async (
  marketIds: string[],
): Promise<Map<string, OmenMarketAnswer>> => {
  const answers = new Map<string, OmenMarketAnswer>();
  const pages = await mapWithConcurrency(chunk(marketIds, IN_FILTER_CHUNK), 4, (ids) =>
    gqlRequest<{
      fixedProductMarketMakers: {
        id: string;
        currentAnswer: string | null;
        answerFinalizedTimestamp: string | null;
        isPendingArbitration: boolean;
      }[];
    }>(OMEN_SUBGRAPH_URL, leaderboardOmenFinalizationQuery, { ids }),
  );
  pages.forEach(({ fixedProductMarketMakers }) =>
    fixedProductMarketMakers.forEach((market) =>
      answers.set(market.id.toLowerCase(), {
        currentAnswer: market.currentAnswer,
        answerFinalizedTimestamp: market.answerFinalizedTimestamp
          ? Number(market.answerFinalizedTimestamp)
          : null,
        isPendingArbitration: market.isPendingArbitration,
      }),
    ),
  );
  return answers;
};

export type PolymarketQuestion = { title: string; winningIndex: number | null };

/** Title and resolution of Polymarket questions, from the squid */
export const fetchPolymarketQuestions = async (
  questionIds: string[],
): Promise<Map<string, PolymarketQuestion>> => {
  const questions = new Map<string, PolymarketQuestion>();
  const pages = await mapWithConcurrency(chunk(questionIds, IN_FILTER_CHUNK), 4, (ids) =>
    gqlRequest<{
      questions: {
        id: string;
        metadata: { title: string | null } | null;
        resolution: { winningIndex: string | null } | null;
      }[];
    }>(POLYMARKET_SQUID_URL, leaderboardPolymarketQuestionsQuery, { ids }),
  );
  pages.forEach((page) =>
    page.questions.forEach(({ id, metadata, resolution }) => {
      const winningIndex = resolution?.winningIndex;
      questions.set(id.toLowerCase(), {
        title: metadata?.title ?? '',
        winningIndex:
          winningIndex === null || winningIndex === undefined ? null : Number(winningIndex),
      });
    }),
  );
  return questions;
};

export type MarketBets = {
  /** Outcome index of each of the agent's bets */
  outcomeIndexes: number[];
  /** What the agent paid for its buys, fees included, in USD; sells are left out */
  buyCost: number;
};

/** The agent's bets by market id, for the given markets */
export const fetchMarketBets = async (
  agentType: AgentType,
  bettor: string,
  marketIds: string[],
): Promise<Map<string, MarketBets>> => {
  const decimals = TOKEN_DECIMALS[agentType];
  const bets = new Map<string, MarketBets>();
  const add = (marketId: string, outcomeIndex: string, amount: string, feeAmount?: string) => {
    const key = marketId.toLowerCase();
    let entry = bets.get(key);
    if (!entry) {
      entry = { outcomeIndexes: [], buyCost: 0 };
      bets.set(key, entry);
    }
    entry.outcomeIndexes.push(Number(outcomeIndex));
    // A sell is a bet with a negative amount (its proceeds)
    if (BigInt(amount) > BigInt(0)) {
      entry.buyCost += toUnits(amount, decimals) + toUnits(feeAmount ?? '0', decimals);
    }
  };

  for (const markets of chunk(marketIds, IN_FILTER_CHUNK)) {
    for (let skip = 0; ; skip += PAGE_SIZE) {
      if (agentType === AGENTS.OMENSTRAT) {
        const page = await gqlRequest<{
          bets: {
            outcomeIndex: string;
            amount: string;
            feeAmount: string;
            fixedProductMarketMaker: { id: string };
          }[];
        }>(PREDICT_OMEN_SUBGRAPH_URL, leaderboardOmenBetsQuery, { bettor, markets, skip });
        page.bets.forEach((bet) =>
          add(bet.fixedProductMarketMaker.id, bet.outcomeIndex, bet.amount, bet.feeAmount),
        );
        if (page.bets.length < PAGE_SIZE) break;
      } else {
        const page = await gqlRequest<{
          bets: { outcomeIndex: string; amount: string; questionId: string }[];
        }>(POLYMARKET_SQUID_URL, leaderboardPolymarketBetsQuery, {
          bettor,
          questions: markets,
          offset: skip,
        });
        page.bets.forEach((bet) => add(bet.questionId, bet.outcomeIndex, bet.amount));
        if (page.bets.length < PAGE_SIZE) break;
      }
    }
  }
  return bets;
};
