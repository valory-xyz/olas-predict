import type { NextApiRequest, NextApiResponse } from 'next';

import {
  DEFAULT_RANK_BY,
  DEFAULT_WINDOW,
  LEADERBOARD_MAX_LIMIT,
  LEADERBOARD_PAGE_SIZE,
} from 'constants/leaderboard';
import type { LeaderboardErrorResponse, LeaderboardListResponse } from 'types/leaderboard';
import { parseAgentType, parseRankBy, parseWindow } from 'utils/leaderboard/params';
import { normalizeSearch } from 'utils/leaderboard/ranking';
import {
  sendBadRequest,
  sendMethodNotAllowed,
  sendUnavailable,
  setSuccessCacheHeaders,
} from 'utils/leaderboard/respond';
import { readSnapshot } from 'utils/leaderboard/snapshot';
import { getLeaderboardPage } from 'utils/leaderboard/views';

/** A non-negative integer query parameter, `fallback` when absent, `null` when malformed */
const parseInteger = (value: string | string[] | undefined, fallback: number) => {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
  return Number(value);
};

/** Public: the ranked list for one agent type, criterion and window, paged, with name search */
const handler = async (
  req: NextApiRequest,
  res: NextApiResponse<LeaderboardListResponse | LeaderboardErrorResponse>,
) => {
  if (req.method !== 'GET') return sendMethodNotAllowed(res);

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
  const search = normalizeSearch(typeof req.query.search === 'string' ? req.query.search : '');

  let snapshot;
  try {
    snapshot = await readSnapshot(agentType);
  } catch (error) {
    console.error('Leaderboard: snapshot read failed', error);
    return sendUnavailable(res);
  }
  if (!snapshot) return sendUnavailable(res);

  const page = getLeaderboardPage({ snapshot, window, rankBy, search, offset, limit });
  setSuccessCacheHeaders(res);
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
