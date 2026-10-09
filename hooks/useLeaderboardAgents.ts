import { useQuery } from '@tanstack/react-query';

import { AgentType } from 'constants/index';
import { LEADERBOARD_MAX_ADDRESSES, LeaderboardWindow } from 'constants/leaderboard';
import type { LeaderboardAgentRecord, LeaderboardAgentsResponse } from 'types/leaderboard';

import { fetchLeaderboardJson } from './useLeaderboard';

/** Ranks and metrics of specific Safes (the pinned agents), in request order */
export const useLeaderboardAgents = ({
  agentType,
  window,
  addresses,
}: {
  agentType: AgentType;
  window: LeaderboardWindow;
  addresses: string[];
}) =>
  useQuery({
    queryKey: ['leaderboardAgents', agentType, window, addresses],
    enabled: addresses.length > 0,
    queryFn: async (): Promise<LeaderboardAgentRecord[]> => {
      const batches: string[][] = [];
      for (let i = 0; i < addresses.length; i += LEADERBOARD_MAX_ADDRESSES) {
        batches.push(addresses.slice(i, i + LEADERBOARD_MAX_ADDRESSES));
      }
      const responses = await Promise.all(
        batches.map((batch) => {
          const params = new URLSearchParams({ agentType, window, addresses: batch.join(',') });
          return fetchLeaderboardJson<LeaderboardAgentsResponse>(
            `/api/leaderboard/agents?${params}`,
          );
        }),
      );
      return responses.flatMap((response) => response.agents);
    },
  });
