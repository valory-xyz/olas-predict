import type { NextApiRequest, NextApiResponse } from 'next';

import type { AgentType } from 'constants/index';
import { LEADERBOARD_AGENT_TYPES } from 'constants/leaderboard';
import { buildLeaderboard } from 'utils/leaderboard/builder';
import { isCronAuthorized, sendMethodNotAllowed } from 'utils/leaderboard/respond';
import {
  readBuilderState,
  readSnapshot,
  writeBuilderState,
  writeSnapshot,
} from 'utils/leaderboard/snapshot';

// Next.js reads `config` statically, so the limit is a literal here; keep MAX_DURATION_MS in step
export const config = { maxDuration: 300 };
const MAX_DURATION_MS = 300_000;
/** Time kept back from the function limit to save the working state */
const SAVE_MARGIN_MS = 60_000;
/**
 * A type whose snapshot is older than this (or that has had no snapshot for this long since
 * its backfill started) fails the run, well inside the trader's 24 h cut-off for a rank
 */
export const MAX_SNAPSHOT_AGE_SECONDS = 3 * 60 * 60;

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
  /**
   * Per agent type, age of the snapshot now served, in seconds; `null` when there is none yet
   * (or it could not be read)
   */
  snapshotAgeSeconds: Partial<Record<AgentType, number | null>>;
  /** Types whose snapshot is older than `MAX_SNAPSHOT_AGE_SECONDS` (or missing for that long) */
  stale: AgentType[];
  updatedAt: string;
};

type TypeResult = {
  status: 'updated' | 'pending';
  unresolvedServices: string[];
  /** When this type's working state started from empty (epoch ms), if known */
  stateCreatedAt?: number;
};

/** Builds one agent type and saves its working state; throws when either failed */
const refreshType = async (agentType: AgentType, deadline: number): Promise<TypeResult> => {
  const state = await readBuilderState(agentType);
  let build;
  let buildError: unknown = null;
  try {
    build = await buildLeaderboard(agentType, state, deadline);
  } catch (error) {
    buildError = error;
  }
  // The builder updates `state` as it goes, so keep what this run fetched even if it failed
  try {
    await writeBuilderState(agentType, state);
  } catch (saveError) {
    // The build error is the one to report; without one, a failed save fails the type, since
    // the backfill does not progress
    if (!buildError) throw saveError;
    console.error(`Saving the ${agentType} leaderboard builder state failed`, saveError);
  }
  if (buildError || !build) throw buildError;
  if (build.snapshot) await writeSnapshot(build.snapshot);
  return {
    status: build.snapshot ? 'updated' : 'pending',
    unresolvedServices: build.unresolvedServices,
    stateCreatedAt: state.createdAt,
  };
};

/** The served snapshot's age in seconds; `null` when there is none or it cannot be read */
const getSnapshotAgeSeconds = async (agentType: AgentType, now: number) => {
  try {
    const { snapshot, isStale } = await readSnapshot(agentType);
    if (!snapshot || isStale) return null;
    return Math.max(0, Math.round((now - Date.parse(snapshot.updatedAt)) / 1000));
  } catch (error) {
    console.error(`Leaderboard: ${agentType} snapshot age unavailable`, error);
    return null;
  }
};

/**
 * Cron-only: rebuilds each agent type's snapshot. Agent types build independently, so one
 * failing source does not block the other, and a type that fails keeps its previous snapshot.
 */
const handler = async (
  req: NextApiRequest,
  res: NextApiResponse<RefreshResponse | { error: string }>,
) => {
  if (req.method !== 'GET') return sendMethodNotAllowed(res);
  if (!isCronAuthorized(req.headers.authorization, process.env.CRON_SECRET))
    return res.status(401).json({ error: 'Unauthorized' });

  const deadline = Date.now() + MAX_DURATION_MS - SAVE_MARGIN_MS;
  const results = await Promise.allSettled(
    LEADERBOARD_AGENT_TYPES.map((agentType) => refreshType(agentType, deadline)),
  );

  const now = Date.now();
  const response: RefreshResponse = {
    updated: [],
    pending: [],
    failed: [],
    unresolvedServices: {},
    snapshotAgeSeconds: {},
    stale: [],
    updatedAt: new Date(now).toISOString(),
  };
  await Promise.all(
    results.map(async (result, index) => {
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
      const age =
        result.status === 'fulfilled' && result.value.status === 'updated'
          ? 0
          : await getSnapshotAgeSeconds(agentType, now);
      response.snapshotAgeSeconds[agentType] = age;
      // Without a snapshot, count from when the backfill started, if known
      const stateCreatedAt =
        result.status === 'fulfilled' ? result.value.stateCreatedAt : undefined;
      const effectiveAge =
        age ?? (stateCreatedAt === undefined ? null : Math.round((now - stateCreatedAt) / 1000));
      if (effectiveAge !== null && effectiveAge > MAX_SNAPSHOT_AGE_SECONDS) {
        console.error(`Leaderboard: ${agentType} snapshot is ${effectiveAge} s old`);
        response.stale.push(agentType);
      }
    }),
  );
  // A failed or stale type answers 500, so Vercel Cron and alerts record the run as failed; the
  // body still says which types updated
  const isHealthy = !response.failed.length && !response.stale.length;
  return res.status(isHealthy ? 200 : 500).json(response);
};

export default handler;
