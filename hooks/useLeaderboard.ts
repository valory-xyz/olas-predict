import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import type { AgentType } from 'constants/index';
import { LEADERBOARD_PAGE_SIZE, LeaderboardWindow, RankBy } from 'constants/leaderboard';
import type { LeaderboardErrorResponse, LeaderboardListResponse } from 'types/leaderboard';
import { getListRestart } from 'utils/leaderboard/params';

export class LeaderboardRequestError extends Error {
  constructor(
    public status: number,
    /** On `409`: the snapshot the server holds now */
    public updatedAt?: string,
  ) {
    super(`Leaderboard request failed with HTTP ${status}`);
  }
}

/** A `200` whose body is not the expected shape */
export class LeaderboardResponseError extends Error {}

export const fetchLeaderboardJson = async <T>(
  url: string,
  isValid: (body: unknown) => body is T,
): Promise<T> => {
  const response = await fetch(url);
  if (!response.ok) {
    const body: Partial<LeaderboardErrorResponse> | null = await response.json().catch(() => null);
    throw new LeaderboardRequestError(response.status, body?.updatedAt);
  }
  const body: unknown = await response.json();
  if (!isValid(body)) throw new LeaderboardResponseError(`Unexpected response from ${url}`);
  return body;
};

const isListResponse = (body: unknown): body is LeaderboardListResponse => {
  const value = body as Partial<LeaderboardListResponse> | null;
  return (
    !!value &&
    Array.isArray(value.agents) &&
    typeof value.updatedAt === 'string' &&
    typeof value.offset === 'number' &&
    typeof value.limit === 'number' &&
    typeof value.totalResults === 'number' &&
    typeof value.totalRanked === 'number'
  );
};

/** Retries transient failures only; a rejected request or a changed snapshot is final */
export const shouldRetryLeaderboard = (failureCount: number, error: Error) =>
  failureCount < 3 &&
  !(error instanceof LeaderboardResponseError) &&
  !(error instanceof LeaderboardRequestError && error.status >= 400 && error.status < 500);

type PageParam = { offset: number; snapshot?: string };

/** Loaded pages stay as they are for this long: no refetch on remount or reconnect before */
const LIST_STALE_TIME_MS = 5 * 60 * 1000;

/**
 * The ranked list, a page at a time for "Load more", filtered by `search` when set. Later pages
 * ask for the first page's snapshot. When "Load more" finds that snapshot replaced (`409`), the
 * list starts over from the first page of the newer one, so pages never mix two snapshots (see
 * `getListRestart`); a failed background refetch keeps the pages shown. The list is not
 * refetched on window focus, so it does not jump back to its first page while being read.
 */
export const useLeaderboard = ({
  agentType,
  rankBy,
  window,
  search,
}: {
  agentType: AgentType;
  rankBy: RankBy;
  window: LeaderboardWindow;
  search: string;
}) => {
  const queryClient = useQueryClient();
  const queryKey = ['leaderboard', agentType, rankBy, window, search];
  const filtersKey = JSON.stringify(queryKey);
  // The snapshot the first page of a restart must come from, until it has arrived
  const pinned = useRef<{ filtersKey: string; snapshot: string } | null>(null);
  const getPinnedSnapshot = () =>
    pinned.current?.filtersKey === filtersKey ? pinned.current.snapshot : undefined;

  const query = useInfiniteQuery({
    queryKey,
    initialPageParam: { offset: 0 } as PageParam,
    queryFn: async ({ pageParam }) => {
      const pinnedSnapshot = pageParam.offset === 0 ? getPinnedSnapshot() : undefined;
      const snapshot = pageParam.snapshot ?? pinnedSnapshot;
      const params = new URLSearchParams({
        agentType,
        rankBy,
        window,
        offset: String(pageParam.offset),
        limit: String(LEADERBOARD_PAGE_SIZE),
      });
      if (search) params.set('search', search);
      if (snapshot) params.set('snapshot', snapshot);
      const page = await fetchLeaderboardJson(`/api/leaderboard?${params}`, isListResponse);
      // Arrived: later refetches of the first page go through the CDN again
      if (pinnedSnapshot && pinned.current?.snapshot === pinnedSnapshot) pinned.current = null;
      return page;
    },
    getNextPageParam: (lastPage, pages): PageParam | undefined => {
      const next = lastPage.offset + lastPage.limit;
      return next < lastPage.totalResults
        ? { offset: next, snapshot: pages[0].updatedAt }
        : undefined;
    },
    retry: shouldRetryLeaderboard,
    staleTime: LIST_STALE_TIME_MS,
    // A loaded list stays put on focus; a list that failed to load tries again
    refetchOnWindowFocus: (query) => !query.state.data,
  });

  const { error, data, isFetchNextPageError } = query;
  const requestError = error instanceof LeaderboardRequestError ? error : null;
  const restart = requestError
    ? getListRestart({
        status: requestError.status,
        conflictUpdatedAt: requestError.updatedAt,
        shownSnapshot: data?.pages[0]?.updatedAt,
        pinnedSnapshot: getPinnedSnapshot(),
        isLoadMoreError: isFetchNextPageError,
        hasData: !!data,
      })
    : null;
  const restartSnapshot = restart ? (restart.snapshot ?? '') : null;

  useEffect(() => {
    if (restartSnapshot === null) return;
    pinned.current = restartSnapshot ? { filtersKey, snapshot: restartSnapshot } : null;
    queryClient.resetQueries({ queryKey, exact: true });
    // Once per failed request
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error]);

  return { ...query, isRestarting: restartSnapshot !== null };
};
