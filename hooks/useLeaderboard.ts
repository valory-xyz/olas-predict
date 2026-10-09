import { useInfiniteQuery } from '@tanstack/react-query';

import { AgentType } from 'constants/index';
import { LEADERBOARD_PAGE_SIZE, LeaderboardWindow, RankBy } from 'constants/leaderboard';
import type { LeaderboardListResponse } from 'types/leaderboard';

export class LeaderboardRequestError extends Error {
  constructor(public status: number) {
    super(`Leaderboard request failed with HTTP ${status}`);
  }
}

export const fetchLeaderboardJson = async <T>(url: string): Promise<T> => {
  const response = await fetch(url);
  if (!response.ok) throw new LeaderboardRequestError(response.status);
  return response.json();
};

/** The ranked list, a page at a time for "Load more", filtered by `search` when set */
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
}) =>
  useInfiniteQuery({
    queryKey: ['leaderboard', agentType, rankBy, window, search],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({
        agentType,
        rankBy,
        window,
        offset: String(pageParam),
        limit: String(LEADERBOARD_PAGE_SIZE),
      });
      if (search) params.set('search', search);
      return fetchLeaderboardJson<LeaderboardListResponse>(`/api/leaderboard?${params}`);
    },
    getNextPageParam: (lastPage) => {
      const next = lastPage.offset + lastPage.limit;
      return next < lastPage.totalResults ? next : undefined;
    },
  });
