import { useQuery } from '@tanstack/react-query';
import { isAddress } from 'viem';

import { AgentType } from 'constants/index';
import { LEADERBOARD_MAX_ADDRESSES, LeaderboardWindow } from 'constants/leaderboard';
import type { LeaderboardAgentRecord, LeaderboardAgentsResponse } from 'types/leaderboard';

import { fetchLeaderboardJson, shouldRetryLeaderboard } from './useLeaderboard';

const isAgentsResponse = (body: unknown): body is LeaderboardAgentsResponse => {
  const value = body as Partial<LeaderboardAgentsResponse> | null;
  return (
    !!value &&
    Array.isArray(value.agents) &&
    value.agents.every((agent) => !!agent && typeof agent.address === 'string')
  );
};

/** Ranks and metrics of specific Safes (the pinned agents), in request order */
export const useLeaderboardAgents = ({
  agentType,
  window,
  addresses,
}: {
  agentType: AgentType;
  window: LeaderboardWindow;
  addresses: string[];
}) => {
  // An invalid address would fail the whole batch
  const valid = addresses.filter((address) => isAddress(address, { strict: false }));
  return useQuery({
    queryKey: ['leaderboardAgents', agentType, window, valid],
    enabled: valid.length > 0,
    // Pinning or unpinning changes the key: keep showing the previous pins meanwhile, but never
    // ranks from another agent type or window
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === agentType && previousQuery?.queryKey[2] === window
        ? previous
        : undefined,
    retry: shouldRetryLeaderboard,
    queryFn: async (): Promise<LeaderboardAgentRecord[]> => {
      const batches: string[][] = [];
      for (let i = 0; i < valid.length; i += LEADERBOARD_MAX_ADDRESSES) {
        batches.push(valid.slice(i, i + LEADERBOARD_MAX_ADDRESSES));
      }
      const responses = await Promise.all(
        batches.map((batch) => {
          const params = new URLSearchParams({ agentType, window, addresses: batch.join(',') });
          return fetchLeaderboardJson(`/api/leaderboard/agents?${params}`, isAgentsResponse);
        }),
      );
      return responses.flatMap((response) => response.agents);
    },
  });
};
