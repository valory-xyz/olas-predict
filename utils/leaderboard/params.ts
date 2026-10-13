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

/** The page takes the first of repeated values; the API routes reject them (`findRepeatedParam`) */
const single = (value: QueryValue) => (Array.isArray(value) ? value[0] : value);

/** Case-insensitive match against a list of lower-case values */
const parseOption = <T extends string>(options: readonly T[], value: QueryValue): T | null => {
  const candidate = single(value)?.trim().toLowerCase();
  return options.find((option) => option === candidate) ?? null;
};

export const parseAgentType = (value: QueryValue): AgentType | null =>
  parseOption(LEADERBOARD_AGENT_TYPES, value);

export const parseWindow = (value: QueryValue): LeaderboardWindow | null =>
  parseOption(LEADERBOARD_WINDOWS, value);

export const parseRankBy = (value: QueryValue): RankBy | null => parseOption(RANK_BY, value);

/** A lowercased Safe address, or `null` when the value is not an address */
export const parseAddress = (value: QueryValue): string | null => {
  const candidate = single(value)?.trim();
  return candidate && isAddress(candidate, { strict: false }) ? candidate.toLowerCase() : null;
};

/** A non-negative integer without leading zeros, `fallback` when absent, `null` when malformed */
export const parseInteger = (value: QueryValue, fallback: number): number | null => {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,8})$/.test(value)) return null;
  return Number(value);
};

/** Clock difference tolerated between the instance that built a snapshot and the one reading */
const SNAPSHOT_CLOCK_SKEW_MS = 60_000;

/**
 * The `snapshot` a later page asks for: a snapshot's `updatedAt`, i.e. a canonical ISO timestamp
 * (`Date#toISOString`) that is not in the future. `null` for anything else, so made-up values
 * cannot be used to bypass the memo and the CDN.
 */
export const parseSnapshotParam = (value: QueryValue, now: number): string | null => {
  if (typeof value !== 'string') return null;
  const time = Date.parse(value);
  if (Number.isNaN(time) || time > now + SNAPSHOT_CLOCK_SKEW_MS) return null;
  return new Date(time).toISOString() === value ? value : null;
};

/** The first of `names` given more than once in the query, if any */
export const findRepeatedParam = (
  query: Partial<Record<string, QueryValue>>,
  names: readonly string[],
): string | null => names.find((name) => Array.isArray(query[name])) ?? null;

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
