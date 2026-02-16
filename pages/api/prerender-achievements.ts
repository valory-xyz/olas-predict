import type { NextApiRequest, NextApiResponse } from 'next';

import { ACHIEVEMENT_TYPES, AGENTS, OLAS_PREDICT_DOMAIN } from 'constants/index';
import { getLookupFile } from 'utils/achievements';

type Result = {
  success: number;
  failed: number;
  warmed: string[];
  errors: string[];
};

const AGENT = AGENTS.POLYSTRAT;
const TYPE = ACHIEVEMENT_TYPES.PAYOUT;

const generateAchievementPageUrl = (betId: string) =>
  `https://${OLAS_PREDICT_DOMAIN}/${AGENT}/achievement?type=${TYPE}&betId=${betId}`;

const generateErrorResponse = (errorMessage: string) => {
  return {
    success: 0,
    failed: 0,
    warmed: [],
    errors: [errorMessage],
  };
};

export default async function handler(req: NextApiRequest, res: NextApiResponse<Result>) {
  if (req.method !== 'GET') {
    return res.status(405).json(generateErrorResponse('Method Not Allowed'));
  }

  const authHeader = req.headers.authorization;
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    return res
      .status(500)
      .json(generateErrorResponse('Server configuration error: CRON_SECRET is not set'));
  }

  if (!authHeader || authHeader !== `Bearer ${cronSecret}`) {
    return res
      .status(401)
      .json(generateErrorResponse('Unauthorized: Invalid or missing authorization token'));
  }

  const result: Result = {
    success: 0,
    failed: 0,
    warmed: [],
    errors: [],
  };

  try {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const lookupData = await getLookupFile(AGENT, TYPE);

    if (!lookupData) {
      result.errors.push(`No lookup file found for ${AGENT} ${TYPE}`);
      return res.status(200).json(result);
    }

    const recentBetIds = Object.keys(lookupData).filter((betId) => {
      const entry = lookupData[betId];
      if (!entry.createdAt) return true;
      const createdDate = new Date(entry.createdAt);
      return createdDate >= oneHourAgo;
    });

    const fetchPromises = recentBetIds.map(async (betId) => {
      const achievementUrl = generateAchievementPageUrl(betId);
      try {
        const response = await fetch(achievementUrl, {
          method: 'GET',
        });
        return {
          success: response.ok,
          url: achievementUrl,
          status: response.status,
        };
      } catch (error) {
        return {
          success: false,
          url: achievementUrl,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    });

    const results = await Promise.allSettled(fetchPromises);

    results.forEach((promiseResult) => {
      if (promiseResult.status === 'fulfilled') {
        const fetchResult = promiseResult.value;
        if (fetchResult.success) {
          result.success++;
          result.warmed.push(fetchResult.url);
        } else {
          result.failed++;
          const errorMsg = fetchResult.error
            ? `Error warming ${fetchResult.url}: ${fetchResult.error}`
            : `Failed to warm ${fetchResult.url}: ${fetchResult.status}`;
          result.errors.push(errorMsg);
        }
      } else {
        result.failed++;
        result.errors.push(`Promise rejected: ${promiseResult.reason}`);
      }
    });

    res.status(200).json(result);
  } catch (error) {
    result.errors.push(`Fatal error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    res.status(500).json(result);
  }
}
