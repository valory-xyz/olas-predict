import type { NextApiRequest, NextApiResponse } from 'next';
import { timingSafeEqual } from 'node:crypto';

import { AgentType } from 'constants/index';
import { LEADERBOARD_AGENT_TYPES } from 'constants/leaderboard';
import { buildLeaderboard } from 'utils/leaderboard/builder';
import { readBuilderState, writeBuilderState, writeSnapshot } from 'utils/leaderboard/snapshot';

const MAX_DURATION_SECONDS = 300;
/** Time kept back from the function limit to save the working state */
const SAVE_MARGIN_MS = 60_000;

export const config = { maxDuration: MAX_DURATION_SECONDS };

type RefreshResponse = {
  updated: AgentType[];
  /** Still backfilling: progress was saved, the previous snapshot (if any) stays in place */
  pending: AgentType[];
  failed: AgentType[];
  updatedAt: string;
};

const isAuthorized = (req: NextApiRequest) => {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.authorization;
  if (!secret || !header) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(header);
  return expected.length === received.length && timingSafeEqual(expected, received);
};

/**
 * Cron-only: rebuilds each agent type's snapshot. Agent types build independently, so one
 * failing source does not block the other, and a type that fails keeps its previous snapshot.
 */
const handler = async (
  req: NextApiRequest,
  res: NextApiResponse<RefreshResponse | { error: string }>,
) => {
  if (!isAuthorized(req)) return res.status(401).json({ error: 'Unauthorized' });

  const deadline = Date.now() + MAX_DURATION_SECONDS * 1000 - SAVE_MARGIN_MS;
  const results = await Promise.allSettled(
    LEADERBOARD_AGENT_TYPES.map(async (agentType) => {
      const state = await readBuilderState(agentType);
      const { state: nextState, snapshot } = await buildLeaderboard(agentType, state, deadline);
      await writeBuilderState(agentType, nextState);
      if (snapshot) await writeSnapshot(snapshot);
      return snapshot ? 'updated' : 'pending';
    }),
  );

  const response: RefreshResponse = {
    updated: [],
    pending: [],
    failed: [],
    updatedAt: new Date().toISOString(),
  };
  results.forEach((result, index) => {
    const agentType = LEADERBOARD_AGENT_TYPES[index];
    if (result.status === 'fulfilled') {
      response[result.value].push(agentType);
    } else {
      console.error(`Leaderboard: ${agentType} refresh failed`, result.reason);
      response.failed.push(agentType);
    }
  });
  return res.status(200).json(response);
};

export default handler;
