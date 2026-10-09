/** Parsing of the leaderboard's query parameters, shared by the API routes and the page. */
import { isAddress } from 'viem';

import { type AgentType, OLAS_PREDICT_DOMAIN } from 'constants/index';
import {
  LEADERBOARD_AGENT_TYPES,
  LEADERBOARD_PATH,
  LEADERBOARD_QUERY_PARAMS,
  LEADERBOARD_WINDOWS,
  type LeaderboardWindow,
  RANK_BY,
  type RankBy,
} from 'constants/leaderboard';

type QueryValue = string | string[] | undefined;

const single = (value: QueryValue) => (Array.isArray(value) ? value[0] : value);

export const parseAgentType = (value: QueryValue): AgentType | null => {
  const candidate = single(value);
  return LEADERBOARD_AGENT_TYPES.find((type) => type === candidate) ?? null;
};

export const parseWindow = (value: QueryValue): LeaderboardWindow | null => {
  const candidate = single(value);
  return LEADERBOARD_WINDOWS.find((window) => window === candidate) ?? null;
};

export const parseRankBy = (value: QueryValue): RankBy | null => {
  const candidate = single(value);
  return RANK_BY.find((rankBy) => rankBy === candidate) ?? null;
};

/** A lowercased Safe address, or `null` when the value is not an address */
export const parseAddress = (value: QueryValue): string | null => {
  const candidate = single(value)?.trim();
  return candidate && isAddress(candidate, { strict: false }) ? candidate.toLowerCase() : null;
};

/** The "See full leaderboard" deep link: this agent type, ranked by ROI, this window, pinned */
export const getLeaderboardUrl = (agentType: AgentType, window: LeaderboardWindow, pin: string) => {
  const params = new URLSearchParams({
    [LEADERBOARD_QUERY_PARAMS.AGENT_TYPE]: agentType,
    [LEADERBOARD_QUERY_PARAMS.RANK_BY]: 'roi',
    [LEADERBOARD_QUERY_PARAMS.WINDOW]: window,
    [LEADERBOARD_QUERY_PARAMS.PIN]: pin,
  });
  return `https://${OLAS_PREDICT_DOMAIN}${LEADERBOARD_PATH}?${params.toString()}`;
};
