/** Shape checks for data read back from storage, which may be truncated or hand-edited. */
import type { AgentType } from 'constants/index';
import {
  LEADERBOARD_SNAPSHOT_SCHEMA_VERSION,
  LEADERBOARD_STATE_SCHEMA_VERSION,
  LEADERBOARD_WINDOWS,
  NOT_RANKED_REASONS,
} from 'constants/leaderboard';
import type { LeaderboardSnapshot } from 'types/leaderboard';

import type { BuilderState } from './snapshot';

export const isRecord = (value: unknown): value is Record<string, unknown> =>
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

const isNumberTuple = (value: unknown, length: number) =>
  Array.isArray(value) &&
  value.length === length &&
  value.every((item) => typeof item === 'number');

const isRecordOf = (value: unknown, isItem: (item: unknown) => boolean) =>
  isRecord(value) && Object.values(value).every(isItem);

const PEARL_STATUSES: unknown[] = ['pearl', 'other', 'malformed', null];

const isPearlLookup = (value: unknown) =>
  isRecord(value) &&
  PEARL_STATUSES.includes(value.status) &&
  typeof value.checkedAt === 'number' &&
  typeof value.failures === 'number' &&
  (value.uri === undefined || typeof value.uri === 'string');

const isPopulationRecord = (value: unknown) =>
  isRecord(value) &&
  isNullableNumber(value.sourceHeight) &&
  typeof value.activeAgents === 'number' &&
  typeof value.pearlAgents === 'number' &&
  typeof value.suspectRuns === 'number';

const isMechEntry = (value: unknown) =>
  isRecord(value) &&
  typeof value.syncedTo === 'number' &&
  Array.isArray(value.requests) &&
  value.requests.every(
    (request) =>
      Array.isArray(request) &&
      request.length === 2 &&
      typeof request[0] === 'string' &&
      typeof request[1] === 'number',
  );

/**
 * Whether `data` is a current-schema builder working state the builder can resume from. Older
 * states without `pendingMarkets` are accepted.
 */
export const isValidBuilderState = (data: unknown): data is BuilderState =>
  isRecord(data) &&
  data.schemaVersion === LEADERBOARD_STATE_SCHEMA_VERSION &&
  isRecordOf(data.pearl, isPearlLookup) &&
  isRecordOf(data.mech, isMechEntry) &&
  isRecordOf(data.tallies, (tallies) => isRecordOf(tallies, (tally) => isNumberTuple(tally, 4))) &&
  isRecordOf(data.titles, (title) => typeof title === 'string') &&
  (data.pendingMarkets === undefined ||
    isRecordOf(data.pendingMarkets, (check) => isNumberTuple(check, 2))) &&
  (data.population === undefined || isPopulationRecord(data.population));
