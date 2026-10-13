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

const isMetrics = (value: unknown) =>
  isRecord(value) &&
  typeof value.roi === 'number' &&
  typeof value.pnl === 'number' &&
  isNullableNumber(value.accuracy) &&
  isNullableNumber(value.brierScore) &&
  isNullableNumber(value.avgTradeSize) &&
  typeof value.volume === 'number' &&
  typeof value.trades === 'number';

/** A ranked entry has both ranks and its metrics; a not-ranked one has a reason and none */
const isWindowEntry = (value: unknown) => {
  if (!isRecord(value)) return false;
  const { metrics, rankByRoi, rankByPnl, notRankedReason } = value;
  if (notRankedReason === null) {
    return typeof rankByRoi === 'number' && typeof rankByPnl === 'number' && isMetrics(metrics);
  }
  return (
    NOT_RANKED_REASON_VALUES.includes(notRankedReason) &&
    rankByRoi === null &&
    rankByPnl === null &&
    metrics === null
  );
};

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
