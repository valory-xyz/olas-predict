/** Response helpers shared by the public leaderboard API routes. */
import type { NextApiResponse } from 'next';
import { timingSafeEqual } from 'node:crypto';

import { TIME_IN_SECONDS } from 'constants/index';
import type { LeaderboardErrorResponse } from 'types/leaderboard';

/** Errors are never cached, so a fixed source or a new snapshot shows up at once */
const NO_STORE = 'no-store';

export const sendBadRequest = (res: NextApiResponse<LeaderboardErrorResponse>, error: string) => {
  res.setHeader('Cache-Control', NO_STORE);
  return res.status(400).json({ error });
};

export const sendMethodNotAllowed = (res: NextApiResponse<LeaderboardErrorResponse>) => {
  res.setHeader('Allow', 'GET');
  res.setHeader('Cache-Control', NO_STORE);
  return res.status(405).json({ error: 'Method not allowed' });
};

export const sendUnavailable = (res: NextApiResponse<LeaderboardErrorResponse>) => {
  res.setHeader('Cache-Control', NO_STORE);
  return res.status(503).json({ error: 'Leaderboard data unavailable' });
};

/**
 * A later page asked for a snapshot that has been replaced: the client starts over from the
 * first page of `updatedAt`
 */
export const sendSnapshotChanged = (
  res: NextApiResponse<LeaderboardErrorResponse>,
  updatedAt: string,
) => {
  res.setHeader('Cache-Control', NO_STORE);
  return res.status(409).json({ error: 'Leaderboard snapshot changed', updatedAt });
};

/**
 * Data changes at most once per refresh run (hourly).
 * - `list`: one URL per page and filter, so a short stale window is fine; later pages carry
 *   `snapshot=` and are checked against the snapshot they belong to.
 * - `agents`: every trader agent's own URL, requested about hourly, so a long
 *   stale-while-revalidate would hand each of them the previous snapshot every time.
 * - `stale`: the last good snapshot while Blob cannot be read, briefly.
 */
export const setSuccessCacheHeaders = (
  res: NextApiResponse,
  kind: 'list' | 'agents',
  isStale: boolean,
) => {
  let value = `public, s-maxage=${TIME_IN_SECONDS.ONE_MINUTE}`;
  if (isStale) value = 'public, s-maxage=10';
  else if (kind === 'list') {
    value = `public, s-maxage=${TIME_IN_SECONDS.FIVE_MINUTES}, stale-while-revalidate=${TIME_IN_SECONDS.FIVE_MINUTES}`;
  }
  res.setHeader('Cache-Control', value);
};

/** Whether an `Authorization` header carries the cron secret; never true without a secret */
export const isCronAuthorized = (header: string | undefined, secret: string | undefined) => {
  if (!secret || !header) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(header);
  return expected.length === received.length && timingSafeEqual(expected, received);
};
