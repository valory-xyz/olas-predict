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

/**
 * Whether a `409`'s snapshot should restart the list: only when it is newer than the one the
 * list already shows (or there is none), so an instance still serving an older snapshot cannot
 * flip the list back and forth.
 */
export const shouldRestartFromSnapshot = (
  conflictUpdatedAt: string | undefined,
  currentUpdatedAt: string | undefined,
): conflictUpdatedAt is string =>
  !!conflictUpdatedAt && (!currentUpdatedAt || conflictUpdatedAt > currentUpdatedAt);

/**
 * Whether and how the list starts over from its first page after a failed request:
 * `{ snapshot }` pins the first page to that snapshot, `{ snapshot: null }` asks for whatever is
 * current, `null` keeps the list as it is (with its error).
 *
 * - A failed background refetch keeps its pages, which all come from one snapshot; the next
 *   Load more decides.
 * - A `409` after a failed Load more (or with nothing shown) restarts from its newer snapshot;
 *   one that is not newer (the stored snapshot went back) restarts without a pin.
 * - A `503` that outlasted the retries on a pinned first page (an instance kept holding an
 *   older snapshot) restarts without a pin, so the list never spins forever. A failed Load more
 *   otherwise keeps the rows shown, with its error.
 */
export const getListRestart = ({
  status,
  conflictUpdatedAt,
  shownSnapshot,
  pinnedSnapshot,
  isLoadMoreError,
  hasData,
}: {
  status: number | undefined;
  conflictUpdatedAt: string | undefined;
  shownSnapshot: string | undefined;
  /** The snapshot the failed first page was pinned to, if any */
  pinnedSnapshot: string | undefined;
  isLoadMoreError: boolean;
  hasData: boolean;
}): { snapshot: string | null } | null => {
  if (hasData && !isLoadMoreError) return null;
  if (status === 409) {
    return shouldRestartFromSnapshot(conflictUpdatedAt, shownSnapshot)
      ? { snapshot: conflictUpdatedAt }
      : { snapshot: null };
  }
  if (status === 503 && !hasData && pinnedSnapshot) return { snapshot: null };
  return null;
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
