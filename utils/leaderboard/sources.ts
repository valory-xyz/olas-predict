/**
 * Server-only fetchers for the leaderboard builder. Each returns plain, normalized data; the
 * builder (`builder.ts`) decides what to fetch and what to keep.
 */
import { type Variables, request } from 'graphql-request';
import { createPublicClient, formatUnits, http, parseAbi } from 'viem';
import { gnosis, polygon } from 'viem/chains';

import {
  AGENTS,
  type AgentType,
  OMEN_SUBGRAPH_URL,
  POLYMARKET_SQUID_URL,
  PREDICT_OMEN_SUBGRAPH_URL,
} from 'constants/index';
import {
  CHAIN_ID_BY_AGENT_TYPE,
  MECH_ANALYTICS_DEFAULT_URL,
  QUESTION_DATA_SEPARATOR,
  SERVICE_REGISTRY_ADDRESSES,
  TOKEN_DECIMALS,
} from 'constants/leaderboard';

import type { AgentDay } from './metrics';
import { SECONDS_PER_DAY } from './metrics';
import { pageById } from './paging';
import {
  leaderboardOmenBetsQuery,
  leaderboardOmenDailyStatisticsQuery,
  leaderboardOmenFinalizationQuery,
  leaderboardOmenTraderAgentsQuery,
  leaderboardPolymarketBetsQuery,
  leaderboardPolymarketDailyStatisticsQuery,
  leaderboardPolymarketQuestionsQuery,
  leaderboardPolymarketTraderAgentsQuery,
} from './queries';
import { HttpStatusError, withRetry } from './retry';

const PAGE_SIZE = 1000;
/** `id_in` / `_in` filters are chunked to stay well inside the indexers' limits */
const IN_FILTER_CHUNK = 500;
const BRIER_SCALE = 1e18;
const METADATA_FETCH_TIMEOUT_MS = 10_000;
/**
 * Longest wait for one GraphQL response. Well inside the refresh route's save margin, so a
 * hung indexer cannot keep the function from saving its working state.
 */
const GRAPHQL_TIMEOUT_MS = 30_000;
/** Days of daily statistics fetched per concurrent Omen page stream */
const OMEN_DAILY_STATS_DAYS_PER_STREAM = 30;

/**
 * One GraphQL request, retried on a `5xx`, timeout or network error while the retry still
 * starts before `deadline` (epoch ms): one flaky answer among a run's hundreds of calls should
 * not fail the whole agent type for the hour.
 */
const gqlRequest = <T>(url: string, document: string, variables: Variables, deadline: number) =>
  withRetry(
    () => request<T>({ url, document, variables, signal: AbortSignal.timeout(GRAPHQL_TIMEOUT_MS) }),
    { deadline },
  );

/** Thrown by a fetcher whose result is needed whole when `deadline` passes before it is done */
export class DeadlineError extends Error {
  constructor() {
    super('Leaderboard refresh deadline passed');
  }
}

const assertBeforeDeadline = (deadline: number) => {
  if (Date.now() >= deadline) throw new DeadlineError();
};

export const chunk = <T>(items: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
};

/**
 * Runs `fn` over `items` with at most `concurrency` calls in flight, keeping order. After the
 * first error no further item is started; the calls in flight are awaited (so none of them is
 * still writing when this returns) and the first error is thrown.
 */
export const mapWithConcurrency = async <T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> => {
  const results: R[] = new Array(items.length);
  let next = 0;
  const failures: unknown[] = [];
  const worker = async () => {
    while (!failures.length && next < items.length) {
      const index = next++;
      try {
        results[index] = await fn(items[index]);
      } catch (error) {
        failures.push(error);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  if (failures.length) throw failures[0];
  return results;
};

/**
 * `promise`'s value, or `undefined` once `deadline` (epoch ms) passes first. The promise is not
 * cancelled; its result is ignored.
 */
export const raceDeadline = async <T>(promise: Promise<T>, deadline: number) => {
  let timer: Parameters<typeof clearTimeout>[0];
  try {
    return await Promise.race([
      promise,
      new Promise<undefined>((resolve) => {
        timer = setTimeout(resolve, Math.max(deadline - Date.now(), 0));
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

/** A token amount given as an integer string, in whole tokens */
const toUnits = (amount: string | number | null | undefined, decimals: number) =>
  amount === null || amount === undefined ? 0 : Number(formatUnits(BigInt(amount), decimals));

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

/** Every trader agent of the type; throws `DeadlineError` once `deadline` (epoch ms) passes */
export const fetchTraderAgents = async (
  agentType: AgentType,
  deadline: number,
): Promise<AgentPopulation> => {
  const agents: TraderAgentRecord[] = [];
  let sourceHeight: number | null = null;

  if (agentType === AGENTS.OMENSTRAT) {
    let idGt = '0x';
    for (;;) {
      assertBeforeDeadline(deadline);
      const page = await gqlRequest<{
        traderAgents: { id: string; serviceId: string }[];
        _meta: { block: { number: number } };
      }>(PREDICT_OMEN_SUBGRAPH_URL, leaderboardOmenTraderAgentsQuery, { idGt }, deadline);
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
    assertBeforeDeadline(deadline);
    const page = await gqlRequest<{
      traderAgents: { id: string; serviceId: string }[];
      squidStatus: { height: number };
    }>(POLYMARKET_SQUID_URL, leaderboardPolymarketTraderAgentsQuery, { idGt }, deadline);
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
  dailyTradedSettled: string;
  dailyProfit: string;
  brierSum: string;
  brierCount: number;
  profitParticipants: { id: string; question: string | null }[];
};

type PolymarketDailyStatisticRow = {
  id: string;
  date: string;
  traderAgentId: string;
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

/**
 * Every agent's daily statistics from `dateGte` (UTC midnight, seconds) onwards; throws
 * `DeadlineError` once `deadline` (epoch ms) passes
 */
export const fetchDailyStatistics = async (
  agentType: AgentType,
  dateGte: number,
  nowSeconds: number,
  deadline: number,
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
        assertBeforeDeadline(deadline);
        const page = await gqlRequest<{ dailyProfitStatistics: OmenDailyStatisticRow[] }>(
          PREDICT_OMEN_SUBGRAPH_URL,
          leaderboardOmenDailyStatisticsQuery,
          { dateGte: String(from), dateLt: String(to), idGt },
          deadline,
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
        tradedSettled: toUnits(row.dailyTradedSettled, decimals),
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
    assertBeforeDeadline(deadline);
    const page = await gqlRequest<{ dailyProfitStatistics: PolymarketDailyStatisticRow[] }>(
      POLYMARKET_SQUID_URL,
      leaderboardPolymarketDailyStatisticsQuery,
      { dateGte: String(dateGte), idGt },
      deadline,
    );
    page.dailyProfitStatistics.forEach((row) => {
      pushDay(daysByAgent, row.traderAgentId.toLowerCase(), {
        date: Number(row.date),
        tradedSettled: toUnits(row.dailyTradedSettled, decimals),
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

/**
 * The leaderboard's own server-side clients, apart from the app's `publicClient`: one retry and
 * a 10 s timeout, so a hanging or rate-limiting RPC cannot hold a run past its deadline.
 */
const RPC_TRANSPORT_OPTIONS = { retryCount: 1, timeout: 10_000 };
const leaderboardClients = {
  100: createPublicClient({
    chain: gnosis,
    transport: http(
      process.env.NEXT_PUBLIC_GNOSIS_URL ?? gnosis.rpcUrls.default.http[0],
      RPC_TRANSPORT_OPTIONS,
    ),
  }),
  // viem's default Polygon RPC (polygon-rpc.com) now rejects unauthenticated calls
  137: createPublicClient({
    chain: polygon,
    transport: http(
      process.env.POLYGON_RPC_URL || 'https://polygon-bor-rpc.publicnode.com',
      RPC_TRANSPORT_OPTIONS,
    ),
  }),
} as const;

/** Services whose tokenURI is read per multicall */
const TOKEN_URI_BATCH = 50;

/**
 * `ServiceRegistry.tokenURI` by service id, and the ids whose call failed. Each multicall is
 * raced against `deadline` (epoch ms). A multicall that did not answer in time, threw, or
 * failed for every id of its batch (`allowFailure` turns a failed RPC request into a failure
 * per call) is an infrastructure failure: its ids are in neither result, so they are not held
 * against the services.
 */
export const fetchTokenUris = async (
  agentType: AgentType,
  serviceIds: string[],
  deadline: number,
): Promise<{ uris: Map<string, string>; failed: string[] }> => {
  const chainId = CHAIN_ID_BY_AGENT_TYPE[agentType] as keyof typeof leaderboardClients;
  const client = leaderboardClients[chainId];
  const uris = new Map<string, string>();
  const failed: string[] = [];
  await mapWithConcurrency(chunk(serviceIds, TOKEN_URI_BATCH), 4, async (ids) => {
    if (Date.now() >= deadline) return;
    let results;
    try {
      results = await raceDeadline(
        client.multicall({
          contracts: ids.map((id) => ({
            address: SERVICE_REGISTRY_ADDRESSES[chainId],
            abi: tokenUriAbi,
            functionName: 'tokenURI' as const,
            args: [BigInt(id)] as const,
          })),
          allowFailure: true,
        }),
        deadline,
      );
    } catch (error) {
      console.error(`Leaderboard: tokenURI multicall failed for ${ids.length} services`, error);
      return;
    }
    if (!results) return;
    if (results.every(({ status }) => status !== 'success')) {
      console.error(`Leaderboard: tokenURI unavailable for ${ids.length} services`, results[0]);
      return;
    }
    results.forEach((result, index) => {
      if (result.status === 'success') uris.set(ids[index], result.result);
      else {
        console.error(`Leaderboard: tokenURI of service ${ids[index]} unavailable`, result.error);
        failed.push(ids[index]);
      }
    });
  });
  return { uris, failed };
};

const fetchJsonWithTimeout = async (url: string, timeoutMs: number): Promise<unknown> => {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.json();
};

const toGatewayUrl = (uri: string) =>
  uri.startsWith('ipfs://') ? `https://gateway.autonolas.tech/ipfs/${uri.slice(7)}` : uri;

/** At least this many reads all failing in one run reads as a gateway outage */
const METADATA_OUTAGE_MIN_READS = 3;

/**
 * Service metadata (the JSON behind each `[serviceId, tokenURI]`) by service id, and the ids
 * whose metadata could not be read. Stops at `deadline` (epoch ms): the services not reached by
 * then are in neither, and each read is cut short at the deadline. When every one of several
 * reads failed, the gateway is taken to be down and `failed` is empty, so an outage does not
 * count against every service.
 */
export const fetchServiceMetadata = async (
  services: [string, string][],
  deadline: number,
): Promise<{ metadata: Map<string, unknown>; failed: string[] }> => {
  const metadata = new Map<string, unknown>();
  const failed: string[] = [];
  await mapWithConcurrency(services, 10, async ([id, uri]) => {
    const timeoutMs = Math.min(METADATA_FETCH_TIMEOUT_MS, deadline - Date.now());
    // Out of time: not attempted, so not a failure
    if (timeoutMs <= 0) return;
    try {
      metadata.set(id, await fetchJsonWithTimeout(toGatewayUrl(uri), timeoutMs));
    } catch (error) {
      // Cut short by the deadline rather than the full timeout: not a failure either
      if (timeoutMs < METADATA_FETCH_TIMEOUT_MS && Date.now() >= deadline) return;
      console.error(`Leaderboard: metadata of service ${id} unavailable`, error);
      failed.push(id);
    }
  });
  if (!metadata.size && failed.length >= METADATA_OUTAGE_MIN_READS) {
    console.error(`Leaderboard: all ${failed.length} metadata reads failed, gateway down?`);
    return { metadata, failed: [] };
  }
  return { metadata, failed };
};

/** One mech request; `title` is `null` for a request without a question title */
export type MechRequestRecord = { title: string | null; timestamp: number };

/** Most rows mech-analytics returns per page */
const MECH_ANALYTICS_PAGE_LIMIT = 5000;
/** Guards against a cursor cycle; ~1M rows for one Safe */
const MECH_ANALYTICS_MAX_PAGES = 200;
const MECH_ANALYTICS_TIMEOUT_MS = 30_000;

const getMechAnalyticsUrl = () => process.env.MECH_ANALYTICS_URL || MECH_ANALYTICS_DEFAULT_URL;

type ScoredRowsPage = { rows: unknown[]; next_cursor?: unknown };

const isScoredRowsPage = (body: unknown): body is ScoredRowsPage =>
  !!body && typeof body === 'object' && Array.isArray((body as ScoredRowsPage).rows);

/** A scored row as a request, or `null` when the row lacks an id or a valid `requested_at` */
const toMechRequest = (row: unknown): (MechRequestRecord & { id: string }) | null => {
  if (!row || typeof row !== 'object') return null;
  const {
    request_id: id,
    requested_at: requestedAt,
    question_title: title,
  } = row as Record<string, unknown>;
  const time = typeof requestedAt === 'string' ? Date.parse(requestedAt) : NaN;
  if (typeof id !== 'string' || Number.isNaN(time)) return null;
  return {
    id,
    title: typeof title === 'string' && title ? title : null,
    timestamp: Math.floor(time / 1000),
  };
};

/**
 * The agent's mech requests made at or after `since` (seconds), oldest first, from
 * mech-analytics' `/v1/data/scored-rows`: the per-Safe list Pearl's trader reads (its templates
 * set `USE_MECH_ANALYTICS`), which holds on-chain, off-chain and backfilled requests. The
 * marketplace subgraphs see on-chain requests only, and most Pearl requests are off-chain now.
 * Like the trader's, this list leaves out requests whose payload could not be parsed.
 *
 * Pages by the endpoint's cursor and stops between pages at `deadline` (epoch ms) with
 * `complete: false`; `requests` then holds every request up to the newest one returned. A
 * failed request (after retries) or an unexpected answer throws, so an outage never reads as
 * "no requests".
 */
export const fetchMechRequests = async (
  agentType: AgentType,
  requester: string,
  since: number,
  deadline: number,
): Promise<{ requests: MechRequestRecord[]; complete: boolean }> => {
  const byId = new Map<string, MechRequestRecord>();
  const result = (complete: boolean) => ({ requests: [...byId.values()], complete });
  let cursor: string | null = null;
  for (let page = 0; page < MECH_ANALYTICS_MAX_PAGES; page++) {
    if (Date.now() >= deadline) return result(false);
    const params = new URLSearchParams({
      requester,
      chain_id: String(CHAIN_ID_BY_AGENT_TYPE[agentType]),
      since: new Date(since * 1000).toISOString(),
      sort: 'requested_at',
      sort_direction: 'asc',
      limit: String(MECH_ANALYTICS_PAGE_LIMIT),
    });
    if (cursor) params.set('cursor', cursor);
    const url = `${getMechAnalyticsUrl()}/v1/data/scored-rows?${params}`;
    const body = await withRetry(
      async () => {
        const response = await fetch(url, {
          signal: AbortSignal.timeout(MECH_ANALYTICS_TIMEOUT_MS),
        });
        if (!response.ok) throw new HttpStatusError(response.status, url);
        return (await response.json()) as unknown;
      },
      { deadline },
    );
    if (!isScoredRowsPage(body)) throw new Error(`Unexpected mech-analytics answer for ${url}`);
    let malformed = 0;
    body.rows.forEach((row) => {
      const request = toMechRequest(row);
      if (!request) {
        malformed += 1;
        return;
      }
      const { id, ...record } = request;
      byId.set(id, record);
    });
    // Like the trader, which dates such a row to the epoch, far outside every window
    if (malformed) console.error(`Leaderboard: ${malformed} mech-analytics rows skipped (${url})`);
    cursor = typeof body.next_cursor === 'string' && body.next_cursor ? body.next_cursor : null;
    if (!cursor) return result(true);
  }
  throw new Error(
    `mech-analytics paging for ${requester} exceeded ${MECH_ANALYTICS_MAX_PAGES} pages`,
  );
};

export type OmenMarketAnswer = {
  currentAnswer: string | null;
  answerFinalizedTimestamp: number | null;
  isPendingArbitration: boolean;
};

/** What a by-id lookup found, and which ids it looked up before the deadline */
export type Lookup<T> = { found: Map<string, T>; checked: string[] };

/**
 * Looks `ids` up in chunks, skipping the chunks not started by `deadline` (epoch ms): those ids
 * are not in `checked`, so the caller can tell "not found" from "not looked up".
 */
const lookUpByIds = async <T>(
  ids: string[],
  deadline: number,
  fetchChunk: (chunkIds: string[]) => Promise<[string, T][]>,
): Promise<Lookup<T>> => {
  const found = new Map<string, T>();
  const checked: string[] = [];
  await mapWithConcurrency(chunk(ids, IN_FILTER_CHUNK), 4, async (chunkIds) => {
    if (Date.now() >= deadline) return;
    (await fetchChunk(chunkIds)).forEach(([id, value]) => found.set(id.toLowerCase(), value));
    checked.push(...chunkIds);
  });
  return { found, checked };
};

/** Answer and finalization of Omen markets, from the Omen subgraph */
export const fetchOmenMarketAnswers = (marketIds: string[], deadline: number) =>
  lookUpByIds<OmenMarketAnswer>(marketIds, deadline, async (ids) => {
    const { fixedProductMarketMakers } = await gqlRequest<{
      fixedProductMarketMakers: {
        id: string;
        currentAnswer: string | null;
        answerFinalizedTimestamp: string | null;
        isPendingArbitration: boolean;
      }[];
    }>(OMEN_SUBGRAPH_URL, leaderboardOmenFinalizationQuery, { ids }, deadline);
    return fixedProductMarketMakers.map((market) => [
      market.id,
      {
        currentAnswer: market.currentAnswer,
        answerFinalizedTimestamp: market.answerFinalizedTimestamp
          ? Number(market.answerFinalizedTimestamp)
          : null,
        isPendingArbitration: market.isPendingArbitration,
      },
    ]);
  });

export type PolymarketQuestion = { title: string; winningIndex: number | null };

/** Title and resolution of Polymarket questions, from the squid */
export const fetchPolymarketQuestions = (questionIds: string[], deadline: number) =>
  lookUpByIds<PolymarketQuestion>(questionIds, deadline, async (ids) => {
    const { questions } = await gqlRequest<{
      questions: {
        id: string;
        metadata: { title: string | null } | null;
        resolution: { winningIndex: string | null } | null;
      }[];
    }>(POLYMARKET_SQUID_URL, leaderboardPolymarketQuestionsQuery, { ids }, deadline);
    return questions.map(({ id, metadata, resolution }) => {
      const winningIndex = resolution?.winningIndex;
      return [
        id,
        {
          title: metadata?.title ?? '',
          winningIndex:
            winningIndex === null || winningIndex === undefined ? null : Number(winningIndex),
        },
      ];
    });
  });

export type MarketBets = {
  /** Outcome index of each of the agent's bets, sells included */
  outcomeIndexes: number[];
  /**
   * What the agent paid for its buys, in USD; sells are left out. An Omen bet's `amount` is the
   * FPMM's `investmentAmount`, which already includes the market fee.
   */
  buyCost: number;
  /** Number of buys */
  buys: number;
};

/**
 * The agent's bets by market id, for the given markets, and the markets whose bets were all
 * read. Stops between pages at `deadline` (epoch ms): the markets of an unfinished chunk are
 * left out of `fetchedMarkets`, so the caller retries them.
 */
export const fetchMarketBets = async (
  agentType: AgentType,
  bettor: string,
  marketIds: string[],
  deadline: number,
): Promise<{ bets: Map<string, MarketBets>; fetchedMarkets: string[] }> => {
  const decimals = TOKEN_DECIMALS[agentType];
  const bets = new Map<string, MarketBets>();
  const fetchedMarkets: string[] = [];
  const add = (marketId: string, outcomeIndex: string, amount: string) => {
    const key = marketId.toLowerCase();
    let entry = bets.get(key);
    if (!entry) {
      entry = { outcomeIndexes: [], buyCost: 0, buys: 0 };
      bets.set(key, entry);
    }
    // Every bet counts towards accuracy, sells included, as in the trader's own
    // `_calculate_omen_accuracy` / `_calculate_polymarket_accuracy` (its bet queries carry no
    // amount), so the leaderboard matches the agent's Profile
    entry.outcomeIndexes.push(Number(outcomeIndex));
    // A sell is a bet with a negative amount (its proceeds)
    if (BigInt(amount) > BigInt(0)) {
      entry.buyCost += toUnits(amount, decimals);
      entry.buys += 1;
    }
  };
  const isPastDeadline = () => Date.now() >= deadline;

  for (const markets of chunk(marketIds, IN_FILTER_CHUNK)) {
    if (agentType === AGENTS.OMENSTRAT) {
      const { rows, complete } = await pageById({
        pageSize: PAGE_SIZE,
        isPastDeadline,
        fetchPage: async (idGt) =>
          (
            await gqlRequest<{
              bets: {
                id: string;
                outcomeIndex: string;
                amount: string;
                fixedProductMarketMaker: { id: string };
              }[];
            }>(
              PREDICT_OMEN_SUBGRAPH_URL,
              leaderboardOmenBetsQuery,
              {
                bettor,
                markets,
                idGt,
              },
              deadline,
            )
          ).bets,
      });
      if (!complete) break;
      rows.forEach((bet) => add(bet.fixedProductMarketMaker.id, bet.outcomeIndex, bet.amount));
    } else {
      const { rows, complete } = await pageById({
        pageSize: PAGE_SIZE,
        isPastDeadline,
        fetchPage: async (idGt) =>
          (
            await gqlRequest<{
              bets: {
                id: string;
                outcomeIndex: string;
                amount: string;
                questionId: string;
              }[];
            }>(
              POLYMARKET_SQUID_URL,
              leaderboardPolymarketBetsQuery,
              {
                bettor,
                questions: markets,
                idGt,
              },
              deadline,
            )
          ).bets,
      });
      if (!complete) break;
      rows.forEach((bet) => add(bet.questionId, bet.outcomeIndex, bet.amount));
    }
    fetchedMarkets.push(...markets);
  }
  return { bets, fetchedMarkets };
};
