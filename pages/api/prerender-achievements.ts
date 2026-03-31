import type { NextApiRequest, NextApiResponse } from 'next';

import { ACHIEVEMENT_TYPES, AGENTS, OLAS_PREDICT_DOMAIN } from 'constants/index';
import { listAchievementEntries } from 'utils/achievements';

type Result = {
  success: number;
  failed: number;
  warmed: string[];
  errors: string[];
};

const AGENT = AGENTS.POLYSTRAT;
const TYPE = ACHIEVEMENT_TYPES.PAYOUT;
const CONCURRENCY_LIMIT = 5;

const generateAchievementPageUrl = (betId: string) =>
  `https://${OLAS_PREDICT_DOMAIN}/${AGENT}/achievement?type=${TYPE}&betId=${encodeURIComponent(betId)}`;

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
    const recentEntries = await listAchievementEntries(AGENT, TYPE, oneHourAgo);

    if (!recentEntries.length) {
      result.errors.push(`No recent achievements found for ${AGENT} ${TYPE}`);
      return res.status(200).json(result);
    }

    const recentBetIds = recentEntries.map((entry) => entry.betId);

    const warmUrl = async (betId: string) => {
      const achievementUrl = generateAchievementPageUrl(betId);
      try {
        const response = await fetch(achievementUrl, { method: 'GET' });
        if (response.ok) {
          result.success++;
          result.warmed.push(achievementUrl);
        } else {
          result.failed++;
          result.errors.push(`Failed to warm ${achievementUrl}: ${response.status}`);
        }
      } catch (error) {
        result.failed++;
        const msg = error instanceof Error ? error.message : 'Unknown error';
        result.errors.push(`Error warming ${achievementUrl}: ${msg}`);
      }
    };

    // Process in batches to avoid overwhelming the server
    for (let i = 0; i < recentBetIds.length; i += CONCURRENCY_LIMIT) {
      const batch = recentBetIds.slice(i, i + CONCURRENCY_LIMIT);
      await Promise.all(batch.map(warmUrl));
    }

    res.status(200).json(result);
  } catch (error) {
    result.errors.push(`Fatal error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    res.status(500).json(result);
  }
}
