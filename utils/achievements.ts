import { list } from '@vercel/blob';
import { gql, request } from 'graphql-request';
import { getMarketThumbnail } from 'graphql/queries';

import {
  ACHIEVEMENTS_LOOKUP_PREFIX,
  ACHIEVEMENT_TYPES,
  IPFS_GATEWAY_URL,
  OLAS_AGENTS_SUBGRAPH_URL,
  OMEN_SUBGRAPH_URL,
} from 'constants/index';
import { SEO_CONFIG } from 'constants/seo';
import { AchievementData } from 'types/achievement';
import { byte32ToIPFSCIDV0 } from 'utils/ipfs';

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
  blockTimestamp: string;
};

type OmenBetWithFifo = OmenBetRow & {
  originalCost: bigint;
  originalShares: bigint;
  remainingShares: bigint;
  allocatedCost: bigint;
  allocatedProceeds: bigint;
};

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
      bets(orderBy: blockTimestamp, orderDirection: asc) {
        id
        outcomeIndex
        amount
        outcomeTokenAmount
        blockTimestamp
      }
    }
  }
`;

const allocateOmenBetFifo = (rows: OmenBetRow[]): Map<string, OmenBetWithFifo> => {
  const sortedRows = [...rows].sort((a, b) => {
    const timestampDifference = Number(BigInt(a.blockTimestamp) - BigInt(b.blockTimestamp));
    return timestampDifference || a.id.localeCompare(b.id);
  });
  const buys = new Map<string, OmenBetWithFifo>();
  const queues = new Map<string, OmenBetWithFifo[]>();

  for (const row of sortedRows) {
    const amount = BigInt(row.amount);
    const shares = BigInt(row.outcomeTokenAmount);
    const outcomeIndex = row.outcomeIndex;
    const queue = queues.get(outcomeIndex) ?? [];
    queues.set(outcomeIndex, queue);

    if (amount > BigInt(0)) {
      const buy: OmenBetWithFifo = {
        ...row,
        originalCost: amount,
        originalShares: shares,
        remainingShares: shares,
        allocatedCost: BigInt(0),
        allocatedProceeds: BigInt(0),
      };
      buys.set(row.id, buy);
      if (shares > BigInt(0)) queue.push(buy);
      continue;
    }

    if (amount === BigInt(0) || shares >= BigInt(0)) continue;

    const sharesSold = -shares;
    const proceeds = -amount;
    let remainingToAllocate = sharesSold;
    while (remainingToAllocate > BigInt(0) && queue.length > 0) {
      const buy = queue[0];
      const taken =
        remainingToAllocate < buy.remainingShares ? remainingToAllocate : buy.remainingShares;
      buy.allocatedProceeds += (proceeds * taken) / sharesSold;
      buy.allocatedCost += (buy.originalCost * taken) / buy.originalShares;
      buy.remainingShares -= taken;
      remainingToAllocate -= taken;
      if (buy.remainingShares <= BigInt(0)) queue.shift();
    }
  }

  return buys;
};

const formatXdai = (wei: bigint) => Number(wei) / 1e18;

/** Fetches Omen achievement figures from the Omen trader subgraph. */
export const fetchOmenAchievementData = async (betId: string): Promise<AchievementData | null> => {
  if (!VALID_ENTRY_ID.test(betId)) return null;

  const { bet } = await request<{ bet: OmenBet | null }>(OLAS_AGENTS_SUBGRAPH_URL, omenBetQuery, {
    id: betId,
  });
  const market = bet?.fixedProductMarketMaker;
  if (!bet || !market) return null;

  const participantId = `${bet.bettor.id}_${market.id}`.toLowerCase();
  const [{ marketParticipant }, { fixedProductMarketMaker: omenMarket }] = await Promise.all([
    request<{
      marketParticipant: { settled: boolean; totalPayout: string; bets: OmenBetRow[] } | null;
    }>(OLAS_AGENTS_SUBGRAPH_URL, omenParticipantQuery, { id: participantId }),
    request<{
      fixedProductMarketMaker: {
        currentAnswer: string | null;
        answerFinalizedTimestamp: string | null;
        isPendingArbitration: boolean;
      } | null;
    }>(OMEN_SUBGRAPH_URL, omenMarketSettlementQuery, { id: market.id }),
  ]);
  const finalizedAt = omenMarket?.answerFinalizedTimestamp
    ? Number(omenMarket.answerFinalizedTimestamp)
    : 0;
  if (
    !marketParticipant?.settled ||
    !omenMarket ||
    omenMarket.isPendingArbitration ||
    !finalizedAt ||
    finalizedAt > Math.floor(Date.now() / 1000)
  ) {
    return null;
  }

  const allocatedBets = allocateOmenBetFifo(marketParticipant.bets);
  const target = allocatedBets.get(betId);
  if (!target || target.originalCost <= BigInt(0)) return null;

  const remainingCost = target.originalCost - target.allocatedCost;
  const allBuys = [...allocatedBets.values()];
  const totalPayout = BigInt(marketParticipant.totalPayout || '0');
  const answer = omenMarket.currentAnswer ? BigInt(omenMarket.currentAnswer) : null;
  if (answer === null || answer > BigInt(1) || Number(target.outcomeIndex) !== Number(answer)) {
    return null;
  }

  const winningCost = allBuys
    .filter((row) => Number(row.outcomeIndex) === Number(answer))
    .reduce((sum, row) => sum + row.originalCost - row.allocatedCost, BigInt(0));
  let amountWonWei = target.allocatedProceeds;
  if (totalPayout > BigInt(0) && winningCost > BigInt(0)) {
    amountWonWei += (totalPayout * remainingCost) / winningCost;
  }

  let marketImageUrl: string | null = null;
  try {
    const thumbnail = await getMarketThumbnail({ id: market.id });
    const imageHash = thumbnail.omenThumbnailMapping?.image_hash;
    if (imageHash) marketImageUrl = `${IPFS_GATEWAY_URL}${byte32ToIPFSCIDV0(imageHash.slice(2))}`;
  } catch {
    // Market images are optional; the market and payout data still render without one.
  }

  const betAmount = formatXdai(target.originalCost);
  const amountWon = formatXdai(amountWonWei);
  if (amountWonWei * BigInt(2) <= target.originalCost * BigInt(3)) return null;
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
    marketImageUrl,
  };
};

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
