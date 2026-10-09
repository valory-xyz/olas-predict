import type { NextApiRequest, NextApiResponse } from 'next';

import { DEFAULT_WINDOW, LEADERBOARD_MAX_ADDRESSES } from 'constants/leaderboard';
import type { LeaderboardAgentsResponse, LeaderboardErrorResponse } from 'types/leaderboard';
import { parseAddress, parseAgentType, parseWindow } from 'utils/leaderboard/params';
import {
  sendBadRequest,
  sendMethodNotAllowed,
  sendUnavailable,
  setSuccessCacheHeaders,
} from 'utils/leaderboard/respond';
import { readSnapshot } from 'utils/leaderboard/snapshot';
import { getAgentRecords } from 'utils/leaderboard/views';

/**
 * Public: ranks under both criteria for specific Safes. Used by the page for pinned agents and
 * by the trader agent for its Profile.
 */
const handler = async (
  req: NextApiRequest,
  res: NextApiResponse<LeaderboardAgentsResponse | LeaderboardErrorResponse>,
) => {
  if (req.method !== 'GET') return sendMethodNotAllowed(res);

  const agentType = parseAgentType(req.query.agentType);
  if (!agentType) return sendBadRequest(res, 'Invalid or missing agentType');
  const window = req.query.window === undefined ? DEFAULT_WINDOW : parseWindow(req.query.window);
  if (!window) return sendBadRequest(res, 'Invalid window');

  const rawAddresses = typeof req.query.addresses === 'string' ? req.query.addresses : '';
  const parts = rawAddresses.split(',').filter((part) => part.trim() !== '');
  const addresses = parts.map((part) => parseAddress(part));
  if (!addresses.length || addresses.some((address) => address === null)) {
    return sendBadRequest(res, 'Missing or malformed addresses');
  }
  const unique = [...new Set(addresses as string[])];
  if (unique.length > LEADERBOARD_MAX_ADDRESSES) {
    return sendBadRequest(res, `At most ${LEADERBOARD_MAX_ADDRESSES} addresses are allowed`);
  }

  let snapshot;
  try {
    snapshot = await readSnapshot(agentType);
  } catch (error) {
    console.error('Leaderboard: snapshot read failed', error);
    return sendUnavailable(res);
  }
  if (!snapshot) return sendUnavailable(res);

  setSuccessCacheHeaders(res);
  return res.status(200).json({
    agentType,
    window,
    totalRanked: snapshot.totalRanked[window],
    updatedAt: snapshot.updatedAt,
    agents: getAgentRecords(snapshot, window, unique),
  });
};

export default handler;
