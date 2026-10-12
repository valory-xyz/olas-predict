/** Shape checks for data read back from storage, which may be truncated or hand-edited. */
import type { AgentType } from 'constants/index';
import {
  LEADERBOARD_SNAPSHOT_SCHEMA_VERSION,
  LEADERBOARD_WINDOWS,
  NOT_RANKED_REASONS,
} from 'constants/leaderboard';
import type { LeaderboardSnapshot } from 'types/leaderboard';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const isNullableNumber = (value: unknown) => value === null || typeof value === 'number';

const NOT_RANKED_REASON_VALUES: unknown[] = Object.values(NOT_RANKED_REASONS);

const isWindowEntry = (value: unknown) =>
  isRecord(value) &&
  (value.metrics === null || isRecord(value.metrics)) &&
  isNullableNumber(value.rankByRoi) &&
  isNullableNumber(value.rankByPnl) &&
  (value.notRankedReason === null || NOT_RANKED_REASON_VALUES.includes(value.notRankedReason));

const isSnapshotAgent = (value: unknown) =>
  isRecord(value) &&
  typeof value.address === 'string' &&
  typeof value.name === 'string' &&
  isRecord(value.windows) &&
  LEADERBOARD_WINDOWS.every((window) => isWindowEntry((value.windows as never)[window]));

/**
 * Whether `data` is a current-schema snapshot for `agentType`, complete enough for the API
 * routes to answer from (every window present for every agent).
 */
export const isValidSnapshot = (data: unknown, agentType: AgentType): data is LeaderboardSnapshot =>
  isRecord(data) &&
  data.schemaVersion === LEADERBOARD_SNAPSHOT_SCHEMA_VERSION &&
  data.agentType === agentType &&
  typeof data.updatedAt === 'string' &&
  isRecord(data.totalRanked) &&
  LEADERBOARD_WINDOWS.every(
    (window) => typeof (data.totalRanked as Record<string, unknown>)[window] === 'number',
  ) &&
  Array.isArray(data.agents) &&
  data.agents.every(isSnapshotAgent) &&
  (data.excluded === undefined ||
    (Array.isArray(data.excluded) && data.excluded.every((a) => typeof a === 'string')));
