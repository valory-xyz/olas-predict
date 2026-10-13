import { useInfiniteQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import type { AgentType } from 'constants/index';
import { LEADERBOARD_PAGE_SIZE, LeaderboardWindow, RankBy } from 'constants/leaderboard';
import type { LeaderboardErrorResponse, LeaderboardListResponse } from 'types/leaderboard';
import { shouldRestartFromSnapshot } from 'utils/leaderboard/params';

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

/**
 * The ranked list, a page at a time for "Load more", filtered by `search` when set. Later pages
 * ask for the first page's snapshot; when the server has a newer one (`409`), the list starts
 * over from the first page of that snapshot, so pages never mix two snapshots.
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
  const filtersKey = [agentType, rankBy, window, search].join('|');
  // The snapshot to restart from after a `409`, for the current filters only
  const [restart, setRestart] = useState<{ filtersKey: string; snapshot: string } | null>(null);
  const snapshot = restart?.filtersKey === filtersKey ? restart.snapshot : undefined;

  const query = useInfiniteQuery({
    queryKey: ['leaderboard', agentType, rankBy, window, search, snapshot ?? null],
    initialPageParam: { offset: 0, snapshot } as PageParam,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({
        agentType,
        rankBy,
        window,
        offset: String(pageParam.offset),
        limit: String(LEADERBOARD_PAGE_SIZE),
      });
      if (search) params.set('search', search);
      if (pageParam.snapshot) params.set('snapshot', pageParam.snapshot);
      return fetchLeaderboardJson(`/api/leaderboard?${params}`, isListResponse);
    },
    getNextPageParam: (lastPage, pages): PageParam | undefined => {
      const next = lastPage.offset + lastPage.limit;
      return next < lastPage.totalResults
        ? { offset: next, snapshot: pages[0].updatedAt }
        : undefined;
    },
    retry: shouldRetryLeaderboard,
  });

  const { error } = query;
  const shownSnapshot = snapshot ?? query.data?.pages[0]?.updatedAt;
  useEffect(() => {
    if (
      error instanceof LeaderboardRequestError &&
      error.status === 409 &&
      shouldRestartFromSnapshot(error.updatedAt, shownSnapshot)
    ) {
      setRestart({ filtersKey, snapshot: error.updatedAt });
    }
  }, [error, filtersKey, shownSnapshot]);

  return query;
};
