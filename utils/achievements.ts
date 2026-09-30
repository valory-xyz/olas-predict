import { list } from '@vercel/blob';

import { ACHIEVEMENTS_LOOKUP_PREFIX, ACHIEVEMENT_TYPES, PEARL_API_URL } from 'constants/index';
import { SEO_CONFIG } from 'constants/seo';
import { AchievementData } from 'types/achievement';

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

const ACHIEVEMENT_DATA_TIMEOUT_MS = 8_000;

type FetchAchievementDataParams = {
  agent: string;
  type: string;
  betId: string;
};

/** Fetches the public card figures from pearl-api during server rendering. */
export const fetchAchievementData = async ({
  agent,
  type,
  betId,
}: FetchAchievementDataParams): Promise<AchievementData | null> => {
  if (!VALID_ENTRY_ID.test(betId)) return null;

  const query = new URLSearchParams({ agent, type, id: betId });
  const response = await fetch(`${PEARL_API_URL}/api/achievement/get-data?${query}`, {
    signal: AbortSignal.timeout(ACHIEVEMENT_DATA_TIMEOUT_MS),
  });

  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`pearl-api get-data returned ${response.status}`);
  }

  return (await response.json()) as AchievementData;
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
