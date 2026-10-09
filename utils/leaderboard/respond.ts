/** Response helpers shared by the public leaderboard API routes. */
import type { NextApiResponse } from 'next';

import { TIME_IN_SECONDS } from 'constants/index';
import type { LeaderboardErrorResponse } from 'types/leaderboard';

export const sendBadRequest = (res: NextApiResponse<LeaderboardErrorResponse>, error: string) =>
  res.status(400).json({ error });

export const sendMethodNotAllowed = (res: NextApiResponse<LeaderboardErrorResponse>) => {
  res.setHeader('Allow', 'GET');
  return res.status(405).json({ error: 'Method not allowed' });
};

export const sendUnavailable = (res: NextApiResponse<LeaderboardErrorResponse>) => {
  res.setHeader('Cache-Control', `public, s-maxage=${TIME_IN_SECONDS.ONE_MINUTE}`);
  return res.status(503).json({ error: 'Leaderboard data unavailable' });
};

/** Data changes at most once per refresh run */
export const setSuccessCacheHeaders = (res: NextApiResponse) =>
  res.setHeader(
    'Cache-Control',
    `public, s-maxage=${TIME_IN_SECONDS.FIVE_MINUTES}, stale-while-revalidate=${TIME_IN_SECONDS.ONE_HOUR}`,
  );
