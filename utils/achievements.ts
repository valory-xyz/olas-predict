import { list } from '@vercel/blob';

import { ACHIEVEMENTS_LOOKUP_PREFIX, ACHIEVEMENT_TYPES } from 'constants/index';
import { SEO_CONFIG } from 'constants/seo';

type AchievementQuery = {
  betId?: string;
  [key: string]: unknown;
};

const getLookupFileName = (agent: string, type: string) =>
  `${ACHIEVEMENTS_LOOKUP_PREFIX}/${agent.toLowerCase()}/${type}.json`;

type AchievementLookupData = {
  [key: string]: {
    ipfsUrl?: string;
  };
};

const getLookupFile = async (
  agent: string,
  type: string,
): Promise<AchievementLookupData | null> => {
  const lookupFilePrefix = getLookupFileName(agent, type);
  const { blobs } = await list({
    prefix: lookupFilePrefix,
    limit: 1,
  });

  if (!blobs.length) return null;

  const blobUrl = blobs[0].url;
  const response = await fetch(blobUrl);

  if (!response.ok) return null;

  return await response.json();
};

const getAchievementOgImage = (
  data: AchievementLookupData | null,
  type: string,
  query: AchievementQuery,
): string | null => {
  if (!data) return null;

  if (type === ACHIEVEMENT_TYPES.PAYOUT) {
    const betId = query.betId;
    if (typeof betId === 'string' && data[betId]?.ipfsUrl) {
      return data[betId].ipfsUrl;
    }
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

  try {
    const achievement = await getLookupFile(agent, type);
    const ogImage = getAchievementOgImage(achievement, type, query);

    return ogImage || defaultImage;
  } catch {
    return defaultImage;
  }
};
