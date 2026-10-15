import type { NextApiRequest, NextApiResponse } from 'next';

import {
  DEFAULT_RANK_BY,
  DEFAULT_WINDOW,
  LEADERBOARD_MAX_LIMIT,
  LEADERBOARD_PAGE_SIZE,
} from 'constants/leaderboard';
import type { LeaderboardErrorResponse, LeaderboardListResponse } from 'types/leaderboard';
import {
  findRepeatedParam,
  parseAgentType,
  parseInteger,
  parseRankBy,
  parseSnapshotParam,
  parseWindow,
} from 'utils/leaderboard/params';
import { normalizeSearch } from 'utils/leaderboard/ranking';
import {
  sendBadRequest,
  sendMethodNotAllowed,
  sendSnapshotChanged,
  sendSnapshotNotYetAvailable,
  sendUnavailable,
  setSuccessCacheHeaders,
} from 'utils/leaderboard/respond';
import { readSnapshot } from 'utils/leaderboard/snapshot';
import { getLeaderboardPage } from 'utils/leaderboard/views';

const PARAMS = ['agentType', 'rankBy', 'window', 'offset', 'limit', 'search', 'snapshot'] as const;

/**
 * Public: the ranked list for one agent type, criterion and window, paged, with name search.
 * Later pages pass the first page's `updatedAt` as `snapshot`, so pages never mix snapshots:
 * once that snapshot has been replaced the route answers `409` with the current `updatedAt`
 * (the client starts over from it); when the client's snapshot is newer than the one this
 * instance holds, it answers a retryable `503`.
 */
const handler = async (
  req: NextApiRequest,
  res: NextApiResponse<LeaderboardListResponse | LeaderboardErrorResponse>,
) => {
  if (req.method !== 'GET') return sendMethodNotAllowed(res);

  const repeated = findRepeatedParam(req.query, PARAMS);
  if (repeated) return sendBadRequest(res, `Repeated query parameter: ${repeated}`);

  const { agentType: agentTypeParam, rankBy: rankByParam, window: windowParam } = req.query;
  const agentType = parseAgentType(agentTypeParam);
  if (!agentType) return sendBadRequest(res, 'Invalid or missing agentType');
  const rankBy = rankByParam === undefined ? DEFAULT_RANK_BY : parseRankBy(rankByParam);
  if (!rankBy) return sendBadRequest(res, 'Invalid rankBy');
  const window = windowParam === undefined ? DEFAULT_WINDOW : parseWindow(windowParam);
  if (!window) return sendBadRequest(res, 'Invalid window');
  const offset = parseInteger(req.query.offset, 0);
  if (offset === null) return sendBadRequest(res, 'Invalid offset');
  const limit = parseInteger(req.query.limit, LEADERBOARD_PAGE_SIZE);
  if (limit === null || limit < 1 || limit > LEADERBOARD_MAX_LIMIT) {
    return sendBadRequest(res, `Invalid limit: must be from 1 to ${LEADERBOARD_MAX_LIMIT}`);
  }
  const search = normalizeSearch(req.query.search as string | undefined);
  const snapshotParam = req.query.snapshot;
  const expectedSnapshot =
    snapshotParam === undefined ? undefined : parseSnapshotParam(snapshotParam, Date.now());
  if (expectedSnapshot === null) return sendBadRequest(res, 'Invalid snapshot');

  let read;
  try {
    read = await readSnapshot(agentType, { minUpdatedAt: expectedSnapshot });
  } catch (error) {
    console.error('Leaderboard: snapshot read failed', error);
    return sendUnavailable(res);
  }
  const { snapshot, isStale } = read;
  if (!snapshot) return sendUnavailable(res);
  if (expectedSnapshot !== undefined && expectedSnapshot !== snapshot.updatedAt) {
    return expectedSnapshot > snapshot.updatedAt
      ? sendSnapshotNotYetAvailable(res)
      : sendSnapshotChanged(res, snapshot.updatedAt);
  }

  const page = getLeaderboardPage({ snapshot, window, rankBy, search, offset, limit });
  setSuccessCacheHeaders(res, 'list', isStale);
  return res.status(200).json({
    agentType,
    rankBy,
    window,
    totalRanked: snapshot.totalRanked[window],
    totalResults: page.totalResults,
    offset,
    limit,
    updatedAt: snapshot.updatedAt,
    agents: page.agents,
  });
};

export default handler;
