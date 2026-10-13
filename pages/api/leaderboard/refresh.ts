import type { NextApiRequest, NextApiResponse } from 'next';

import type { AgentType } from 'constants/index';
import { LEADERBOARD_AGENT_TYPES } from 'constants/leaderboard';
import { buildLeaderboard } from 'utils/leaderboard/builder';
import { isCronAuthorized } from 'utils/leaderboard/respond';
import { readBuilderState, writeBuilderState, writeSnapshot } from 'utils/leaderboard/snapshot';

// Next.js reads `config` statically, so the limit is a literal here; keep MAX_DURATION_MS in step
export const config = { maxDuration: 300 };
const MAX_DURATION_MS = 300_000;
/** Time kept back from the function limit to save the working state */
const SAVE_MARGIN_MS = 60_000;

type RefreshResponse = {
  updated: AgentType[];
  /** Still backfilling: progress was saved, the previous snapshot (if any) stays in place */
  pending: AgentType[];
  failed: AgentType[];
  /**
   * Per agent type, active services whose Pearl flag could not be read after repeated tries;
   * they are left out of the snapshot until a later lookup succeeds
   */
  unresolvedServices: Partial<Record<AgentType, string[]>>;
  updatedAt: string;
};

/**
 * Cron-only: rebuilds each agent type's snapshot. Agent types build independently, so one
 * failing source does not block the other, and a type that fails keeps its previous snapshot.
 */
const handler = async (
  req: NextApiRequest,
  res: NextApiResponse<RefreshResponse | { error: string }>,
) => {
  if (!isCronAuthorized(req.headers.authorization, process.env.CRON_SECRET))
    return res.status(401).json({ error: 'Unauthorized' });

  const deadline = Date.now() + MAX_DURATION_MS - SAVE_MARGIN_MS;
  const results = await Promise.allSettled(
    LEADERBOARD_AGENT_TYPES.map(async (agentType) => {
      const state = await readBuilderState(agentType);
      let snapshot;
      let unresolvedServices: string[] = [];
      try {
        ({ snapshot, unresolvedServices } = await buildLeaderboard(agentType, state, deadline));
      } finally {
        // The builder updates `state` as it goes, so keep what this run fetched even if it failed.
        // A failed save must not replace the build error pending from `try`.
        try {
          await writeBuilderState(agentType, state);
        } catch (error) {
          console.error(`Saving the ${agentType} leaderboard builder state failed`, error);
        }
      }
      if (snapshot) await writeSnapshot(snapshot);
      return { status: snapshot ? ('updated' as const) : ('pending' as const), unresolvedServices };
    }),
  );

  const response: RefreshResponse = {
    updated: [],
    pending: [],
    failed: [],
    unresolvedServices: {},
    updatedAt: new Date().toISOString(),
  };
  results.forEach((result, index) => {
    const agentType = LEADERBOARD_AGENT_TYPES[index];
    if (result.status === 'fulfilled') {
      response[result.value.status].push(agentType);
      if (result.value.unresolvedServices.length) {
        response.unresolvedServices[agentType] = result.value.unresolvedServices;
      }
    } else {
      console.error(`Leaderboard: ${agentType} refresh failed`, result.reason);
      response.failed.push(agentType);
    }
  });
  // A failed type answers 500, so Vercel Cron records the run as failed; the body still says
  // which types updated
  return res.status(response.failed.length ? 500 : 200).json(response);
};

export default handler;
