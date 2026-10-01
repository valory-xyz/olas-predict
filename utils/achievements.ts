import { list } from '@vercel/blob';
import { GraphQLClient, gql } from 'graphql-request';

import {
  ACHIEVEMENTS_LOOKUP_PREFIX,
  ACHIEVEMENT_TYPES,
  OLAS_AGENTS_SUBGRAPH_URL,
  OMEN_SUBGRAPH_URL,
} from 'constants/index';
import { SEO_CONFIG } from 'constants/seo';
import { AchievementData } from 'types/achievement';
import {
  allocateBetsFifo,
  getOmenBuyPayout,
  isAchievementMultiplierEligible,
} from 'utils/betPayout';

type AchievementQuery = {
  betId?: string;
  [key: string]: unknown;
};

export type AchievementEntryData = {
  ipfsUrl?: string;
  ipfsHash?: string;
  createdAt?: string | number;
};

type AchievementLookupData = {
  [key: string]: AchievementEntryData;
};

// New per-entry path: achievements-lookup/{agent}/{type}/{id}.json
const getEntryPrefix = (agent: string, type: string, entryId: string) =>
  `${ACHIEVEMENTS_LOOKUP_PREFIX}/${agent.toLowerCase()}/${type}/${entryId}.json`;

// Legacy monolithic path: achievements-lookup/{agent}/{type}.json
const getLegacyFileName = (agent: string, type: string) =>
  `${ACHIEVEMENTS_LOOKUP_PREFIX}/${agent.toLowerCase()}/${type}.json`;

/**
 * Fetches the legacy monolithic lookup file.
 */
const getLegacyLookupFile = async (
  agent: string,
  type: string,
): Promise<AchievementLookupData | null> => {
  const prefix = getLegacyFileName(agent, type);
  const { blobs } = await list({ prefix, limit: 1 });

  if (!blobs.length) return null;

  const response = await fetch(blobs[0].url);
  if (!response.ok) return null;

  return await response.json();
};

const SKIP_LEGACY = process.env.NEXT_PUBLIC_SKIP_LEGACY_ACHIEVEMENTS === 'true';

// Only allow alphanumeric characters, hyphens, and underscores in entry IDs
export const VALID_ENTRY_ID = /^[\w-]+$/;

type OmenBet = {
  id: string;
  outcomeIndex: string;
  amount: string;
  outcomeTokenAmount: string;
  timestamp: string;
  transactionHash: string;
  bettor: { id: string };
  fixedProductMarketMaker: {
    id: string;
    question: string | null;
    outcomes: string[] | null;
    currentAnswer: string | null;
  } | null;
};

type OmenBetRow = {
  id: string;
  outcomeIndex: string;
  amount: string;
  outcomeTokenAmount: string;
  blockNumber: string;
  blockTimestamp: string;
};

const OMEN_SHARES_EPSILON = BigInt('10000000000000000');

const omenBetQuery = gql`
  query AchievementOmenBet($id: ID!) {
    bet(id: $id) {
      id
      outcomeIndex
      amount
      outcomeTokenAmount
      timestamp
      transactionHash
      bettor {
        id
      }
      fixedProductMarketMaker {
        id
        question
        outcomes
        currentAnswer
      }
    }
  }
`;

const omenMarketSettlementQuery = gql`
  query AchievementOmenMarketSettlement($id: ID!) {
    fixedProductMarketMaker(id: $id) {
      currentAnswer
      currentAnswerTimestamp
      answerFinalizedTimestamp
      isPendingArbitration
    }
  }
`;

const omenParticipantQuery = gql`
  query AchievementOmenParticipant($id: ID!) {
    marketParticipant(id: $id) {
      settled
      totalPayout
      bets(first: 1000, orderBy: blockTimestamp, orderDirection: asc) {
        id
        outcomeIndex
        amount
        outcomeTokenAmount
        blockNumber
        blockTimestamp
      }
    }
  }
`;

const getOmenLogIndex = (id: string): number => {
  const suffix = id.slice(-8);
  if (!/^[\da-f]{8}$/i.test(suffix)) return 0;
  return Number.parseInt(suffix.match(/../g)!.reverse().join(''), 16);
};

const createSubgraphClient = (url: string) => ({
  client: new GraphQLClient(url, {
    fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(10_000) }),
  }),
});

const formatXdai = (wei: bigint) => Number(wei) / 1e18;

/** Fetches Omen achievement figures from the Omen trader subgraph. */
const fetchOmenAchievementData = async (betId: string): Promise<AchievementData | null> => {
  if (!VALID_ENTRY_ID.test(betId)) return null;

  const agentsSubgraph = createSubgraphClient(OLAS_AGENTS_SUBGRAPH_URL);
  const omenSubgraph = createSubgraphClient(OMEN_SUBGRAPH_URL);
  const { bet } = await agentsSubgraph.client.request<{ bet: OmenBet | null }>(omenBetQuery, {
    id: betId.toLowerCase(),
  });
  const market = bet?.fixedProductMarketMaker;
  if (!bet || !market) return null;

  const participantId = `${bet.bettor.id}_${market.id}`.toLowerCase();
  const [{ marketParticipant }, { fixedProductMarketMaker: omenMarket }] = await Promise.all([
    agentsSubgraph.client.request<{
      marketParticipant: {
        settled: boolean;
        totalPayout: string | null;
        bets: OmenBetRow[];
      } | null;
    }>(omenParticipantQuery, { id: participantId }),
    omenSubgraph.client.request<{
      fixedProductMarketMaker: {
        currentAnswer: string | null;
        currentAnswerTimestamp: string | null;
        answerFinalizedTimestamp: string | null;
        isPendingArbitration: boolean;
      } | null;
    }>(omenMarketSettlementQuery, { id: market.id }),
  ]);
  const finalizedAt = omenMarket?.answerFinalizedTimestamp
    ? Number(omenMarket.answerFinalizedTimestamp)
    : 0;
  if (!marketParticipant || !omenMarket) return null;

  const allocatedBets = allocateBetsFifo(
    marketParticipant.bets.map((row) => ({
      id: row.id,
      outcomeIndex: Number(row.outcomeIndex),
      amount: BigInt(row.amount),
      shares: BigInt(row.outcomeTokenAmount),
      blockNumber: BigInt(row.blockNumber),
      blockTimestamp: BigInt(row.blockTimestamp),
      logIndex: getOmenLogIndex(row.id),
      isBuy: BigInt(row.amount) > BigInt(0),
    })),
  );
  const target = allocatedBets.get(betId.toLowerCase());
  if (!target || target.originalCost <= BigInt(0)) return null;

  const fullySold = target.remainingShares <= OMEN_SHARES_EPSILON;
  let amountWonWei: bigint | null;
  if (fullySold) {
    // Match the trader: fully exited profitable buys settle from realized proceeds,
    // independent of the market outcome. The achievement checker requires settled_at,
    // which is populated when Omen has a currentAnswerTimestamp.
    if (!omenMarket.currentAnswerTimestamp) return null;
    amountWonWei = getOmenBuyPayout(
      allocatedBets,
      betId.toLowerCase(),
      BigInt(marketParticipant.totalPayout || '0'),
      -1,
      true,
    );
  } else {
    const answer = omenMarket.currentAnswer ? BigInt(omenMarket.currentAnswer) : null;
    if (
      BigInt(marketParticipant.totalPayout || '0') <= BigInt(0) ||
      omenMarket.isPendingArbitration ||
      !finalizedAt ||
      finalizedAt > Math.floor(Date.now() / 1000) ||
      answer === null ||
      answer > BigInt(1) ||
      Number(target.outcomeIndex) !== Number(answer)
    ) {
      return null;
    }
    amountWonWei = getOmenBuyPayout(
      allocatedBets,
      betId.toLowerCase(),
      BigInt(marketParticipant.totalPayout || '0'),
      Number(answer),
      false,
    );
  }
  if (
    amountWonWei === null ||
    !isAchievementMultiplierEligible(amountWonWei, target.originalCost, 18)
  )
    return null;

  const betAmount = formatXdai(target.originalCost);
  const amountWon = formatXdai(amountWonWei);
  const position = market.outcomes?.[Number(bet.outcomeIndex)] || 'n/a';

  return {
    question: market.question || 'n/a',
    position,
    transactionHash: bet.transactionHash,
    betAmount,
    amountWon,
    betAmountFormatted: `$${betAmount.toFixed(2)}`,
    amountWonFormatted: `$${amountWon.toFixed(2)}`,
    multiplier: betAmount > 0 ? (amountWon / betAmount).toFixed(2) : '0.00',
  };
};

export { fetchOmenAchievementData };

/**
 * Fetches a single achievement entry by its ID.
 * Tries the new per-entry format first, falls back to the legacy monolithic file.
 * Set NEXT_PUBLIC_SKIP_LEGACY_ACHIEVEMENTS=true once migration is complete to skip legacy lookups.
 */
export const getAchievementEntry = async (
  agent: string,
  type: string,
  entryId: string,
): Promise<AchievementEntryData | null> => {
  if (!VALID_ENTRY_ID.test(entryId)) return null;

  // Try new per-entry format
  const entryBlobPrefix = getEntryPrefix(agent, type, entryId);
  const { blobs } = await list({ prefix: entryBlobPrefix, limit: 1 });

  if (blobs.length > 0) {
    const response = await fetch(blobs[0].url);
    if (response.ok) return await response.json();
  }

  if (SKIP_LEGACY) return null;

  // Fall back to legacy monolithic file (remove after migration is confirmed complete)
  const legacyData = await getLegacyLookupFile(agent, type);
  if (legacyData && legacyData[entryId]) {
    return legacyData[entryId];
  }

  return null;
};

const getAchievementOgImage = (data: AchievementEntryData | null, type: string): string | null => {
  if (!data) return null;

  if (type === ACHIEVEMENT_TYPES.PAYOUT) {
    return data.ipfsUrl || null;
  }

  return null;
};

type FetchAchievementOgImageParams = {
  agent?: string;
  type?: string;
  query: AchievementQuery;
};

export const fetchAchievementOgImage = async ({
  agent,
  type,
  query,
}: FetchAchievementOgImageParams): Promise<string> => {
  const defaultImage = SEO_CONFIG.ogImage;

  if (!agent || !type || typeof agent !== 'string' || typeof type !== 'string') {
    return defaultImage;
  }

  const betId = query.betId;
  if (typeof betId !== 'string') {
    return defaultImage;
  }

  try {
    const entry = await getAchievementEntry(agent, type, betId);
    const ogImage = getAchievementOgImage(entry, type);

    return ogImage || defaultImage;
  } catch {
    return defaultImage;
  }
};
