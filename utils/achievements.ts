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

type AchievementLookupData = {
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

const SKIP_LEGACY = process.env.NEXT_PUBLIC_SKIP_LEGACY_ACHIEVEMENTS === 'true';

// Only allow alphanumeric characters, hyphens, and underscores in entry IDs
const VALID_ENTRY_ID = /^[\w-]+$/;

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

  // List per-entry blobs (paginated)
  const prefix = getDirectoryPrefix(agent, type);
  let cursor: string | undefined;
  do {
    const response = await list({ prefix, cursor });
    for (const blob of response.blobs) {
      const fileName = blob.pathname.split('/').pop() || '';
      if (!fileName || !fileName.endsWith('.json')) continue;
      const betId = fileName.slice(0, -'.json'.length);
      if (!betId) continue;
      const uploadedAt = new Date(blob.uploadedAt);
      if (!since || uploadedAt >= since) {
        results.set(betId, uploadedAt);
      }
    }
    cursor = response.hasMore ? response.cursor : undefined;
  } while (cursor);

  // Also check legacy monolithic file for entries not yet in per-entry format
  // (remove after migration is confirmed complete)
  if (!SKIP_LEGACY) {
    const legacyData = await getLegacyLookupFile(agent, type);
    if (legacyData) {
      for (const [betId, entry] of Object.entries(legacyData)) {
        if (results.has(betId)) continue; // per-entry takes precedence
        if (entry.createdAt) {
          const createdAt = new Date(entry.createdAt);
          if (!since || createdAt >= since) {
            results.set(betId, createdAt);
          }
        } else {
          // Entries without createdAt are treated as recent to preserve legacy behavior
          results.set(betId, new Date());
        }
      }
    }
  }

  return Array.from(results.entries()).map(([betId, uploadedAt]) => ({
    betId,
    uploadedAt,
  }));
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
