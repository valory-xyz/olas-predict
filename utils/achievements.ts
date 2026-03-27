import { list } from '@vercel/blob';

import { ACHIEVEMENTS_LOOKUP_PREFIX, ACHIEVEMENT_TYPES } from 'constants/index';
import { SEO_CONFIG } from 'constants/seo';

type AchievementQuery = {
  betId?: string;
  [key: string]: unknown;
};

export type AchievementEntryData = {
  ipfsUrl?: string;
  ipfsHash?: string;
  createdAt?: string | number;
};

export type AchievementLookupData = {
  [key: string]: AchievementEntryData;
};

// New per-entry path: achievements-lookup/{agent}/{type}/{id}.json
const getEntryPrefix = (agent: string, type: string, entryId: string) =>
  `${ACHIEVEMENTS_LOOKUP_PREFIX}/${agent.toLowerCase()}/${type}/${entryId}.json`;

// Per-entry directory prefix for listing: achievements-lookup/{agent}/{type}/
const getDirectoryPrefix = (agent: string, type: string) =>
  `${ACHIEVEMENTS_LOOKUP_PREFIX}/${agent.toLowerCase()}/${type}/`;

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

/**
 * Fetches a single achievement entry by its ID.
 * Tries the new per-entry format first, falls back to the legacy monolithic file.
 */
export const getAchievementEntry = async (
  agent: string,
  type: string,
  entryId: string,
): Promise<AchievementEntryData | null> => {
  // Try new per-entry format
  const entryBlobPrefix = getEntryPrefix(agent, type, entryId);
  const { blobs } = await list({ prefix: entryBlobPrefix, limit: 1 });

  if (blobs.length > 0) {
    const response = await fetch(blobs[0].url);
    if (response.ok) return await response.json();
  }

  // Fall back to legacy monolithic file
  const legacyData = await getLegacyLookupFile(agent, type);
  if (legacyData && legacyData[entryId]) {
    return legacyData[entryId];
  }

  return null;
};

/**
 * Lists all achievement entries for an agent/type, optionally filtered by recency.
 * Merges results from both new per-entry blobs and legacy monolithic file.
 */
export const listAchievementEntries = async (
  agent: string,
  type: string,
  since?: Date,
): Promise<{ betId: string; uploadedAt: Date }[]> => {
  const results = new Map<string, Date>();

  // List per-entry blobs
  const prefix = getDirectoryPrefix(agent, type);
  const { blobs } = await list({ prefix });

  for (const blob of blobs) {
    const fileName = blob.pathname.split('/').pop() || '';
    const betId = fileName.replace('.json', '');
    const uploadedAt = new Date(blob.uploadedAt);
    if (!since || uploadedAt >= since) {
      results.set(betId, uploadedAt);
    }
  }

  // Also check legacy monolithic file for entries not yet in per-entry format
  const legacyData = await getLegacyLookupFile(agent, type);
  if (legacyData) {
    for (const [betId, entry] of Object.entries(legacyData)) {
      if (results.has(betId)) continue; // per-entry takes precedence
      const createdAt = entry.createdAt ? new Date(entry.createdAt) : new Date(0);
      if (!since || createdAt >= since) {
        results.set(betId, createdAt);
      }
    }
  }

  return Array.from(results.entries()).map(([betId, uploadedAt]) => ({
    betId,
    uploadedAt,
  }));
};

const getAchievementOgImage = (
  data: AchievementEntryData | null,
  type: string,
): string | null => {
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
