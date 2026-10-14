/**
 * Server-only storage of the leaderboard in Vercel Blob: one snapshot per agent type, which
 * the public endpoints read, and the builder's working state, which only the refresh route
 * reads and writes. Uses the runtime-only `BLOB_READ_WRITE_TOKEN`.
 */
import { BlobNotFoundError, head, put } from '@vercel/blob';

import type { AgentType } from 'constants/index';
import { LEADERBOARD_BLOB_PREFIX, LEADERBOARD_STATE_SCHEMA_VERSION } from 'constants/leaderboard';
import type { LeaderboardSnapshot } from 'types/leaderboard';

import type { MarketTallies } from './metrics';
import type { PearlLookup } from './pearl';
import type { PendingMarketCheck } from './pending';
import { isRecord, isValidBuilderState, isValidSnapshot } from './validate';

/** How long a warm function trusts its in-memory snapshot before checking Blob again */
const SNAPSHOT_MEMO_TTL_MS = 60_000;
/** After a failed read, how soon the last good snapshot is checked against Blob again */
const SNAPSHOT_RETRY_MS = 10_000;
/** How soon a client's newer `snapshot` may trigger another Blob check of the memo */
const SNAPSHOT_MIN_RECHECK_MS = 5_000;
/** Shortest edge cache Blob allows, so a rewritten snapshot is visible within a minute */
const BLOB_CACHE_MAX_AGE_SECONDS = 60;

export type BuilderState = {
  schemaVersion: number;
  /** Pearl flag lookup per service id */
  pearl: Record<string, PearlLookup>;
  /**
   * Per agent: mech requests from mech-analytics as [title key, timestamp (s)], and the newest
   * request time fetched (each run re-reads from a day before it)
   */
  mech: Record<string, { syncedTo: number; requests: [string, number][] }>;
  /** Per agent: the tally of each market with a final answer (see `MarketTally`) */
  tallies: Record<string, MarketTallies>;
  /** Polymarket question id -> title key (Omen titles come with the daily statistics) */
  titles: Record<string, string>;
  /**
   * Settled markets not tallied yet, by market id: when the next lookup is due and how many
   * lookups in a row missed (see `pending.ts`). Absent in states saved before it existed.
   */
  pendingMarkets?: Record<string, PendingMarketCheck>;
};

export const createEmptyState = (): BuilderState => ({
  schemaVersion: LEADERBOARD_STATE_SCHEMA_VERSION,
  pearl: {},
  mech: {},
  tallies: {},
  titles: {},
  pendingMarkets: {},
});

const getSnapshotPath = (agentType: AgentType) =>
  `${LEADERBOARD_BLOB_PREFIX}/${agentType}/snapshot.json`;

const getStatePath = (agentType: AgentType) =>
  `${LEADERBOARD_BLOB_PREFIX}/${agentType}/builder-state.json`;

// The SDK's error classes do not set `name`, so match on the class
const isNotFound = (error: unknown) => error instanceof BlobNotFoundError;

/** Blob metadata, or `null` when the blob does not exist */
const headBlob = async (pathname: string) => {
  try {
    return await head(pathname);
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
};

const fetchBlobJson = async <T>(url: string, uploadedAt: string): Promise<T> => {
  // The query string bypasses the edge cache of the previous version
  const response = await fetch(`${url}?v=${encodeURIComponent(uploadedAt)}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Blob read failed: HTTP ${response.status} for ${url}`);
  return (await response.json()) as T;
};

const writeJsonBlob = async (pathname: string, data: unknown) => {
  await put(pathname, JSON.stringify(data), {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
    cacheControlMaxAge: BLOB_CACHE_MAX_AGE_SECONDS,
  });
};

/**
 * The saved working state, or an empty one when there is none, it has an older schema, or it is
 * unreadable (truncated JSON, wrong shape), so a bad save cannot make every refresh fail. A
 * failed Blob request still throws: starting over then would overwrite a good state.
 */
export const readBuilderState = async (agentType: AgentType): Promise<BuilderState> => {
  const blob = await headBlob(getStatePath(agentType));
  if (!blob) return createEmptyState();
  let state: unknown;
  try {
    state = await fetchBlobJson<unknown>(blob.url, blob.uploadedAt.toISOString());
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    console.error(`Leaderboard: ${agentType} builder state is not JSON, starting over`, error);
    return createEmptyState();
  }
  if (isRecord(state) && state.schemaVersion !== LEADERBOARD_STATE_SCHEMA_VERSION) {
    return createEmptyState();
  }
  if (!isValidBuilderState(state)) {
    console.error(`Leaderboard: ${agentType} builder state has an invalid shape, starting over`);
    return createEmptyState();
  }
  return state;
};

export const writeBuilderState = (agentType: AgentType, state: BuilderState) =>
  writeJsonBlob(getStatePath(agentType), state);

export const writeSnapshot = (snapshot: LeaderboardSnapshot) =>
  writeJsonBlob(getSnapshotPath(snapshot.agentType), snapshot);

type MemoEntry = {
  snapshot: LeaderboardSnapshot | null;
  uploadedAt: string | null;
  checkedAt: number;
  /** The last read failed, so `snapshot` is the last good one */
  isStale: boolean;
};
const snapshotMemo = new Map<AgentType, MemoEntry>();

export type SnapshotRead = {
  /** `null` when no snapshot exists yet */
  snapshot: LeaderboardSnapshot | null;
  /** Blob could not be read (or held an invalid snapshot): this is the last good snapshot */
  isStale: boolean;
};

/**
 * The current snapshot for an agent type. Memoized per warm function and only re-downloaded
 * when Blob has a newer one; `minUpdatedAt` skips the memo when it is older than that (a client
 * already saw a newer snapshot on another instance), at most once per `SNAPSHOT_MIN_RECHECK_MS`.
 * An older or equal `minUpdatedAt` is answered from the memo, without a Blob request.
 *
 * A snapshot that fails validation (wrong shape, schema version or agent type) counts as a
 * failed read. When a read fails, the last good snapshot this function holds is served, marked
 * stale, and Blob is checked again shortly; without one, the error is thrown.
 */
export const readSnapshot = async (
  agentType: AgentType,
  { minUpdatedAt }: { minUpdatedAt?: string } = {},
): Promise<SnapshotRead> => {
  const memo = snapshotMemo.get(agentType);
  const sinceCheck = memo ? Date.now() - memo.checkedAt : Infinity;
  const isMemoOlder =
    !!minUpdatedAt &&
    !!memo?.snapshot &&
    memo.snapshot.updatedAt < minUpdatedAt &&
    sinceCheck >= SNAPSHOT_MIN_RECHECK_MS;
  if (memo && !isMemoOlder && sinceCheck < SNAPSHOT_MEMO_TTL_MS) {
    return { snapshot: memo.snapshot, isStale: memo.isStale };
  }

  try {
    const blob = await headBlob(getSnapshotPath(agentType));
    const uploadedAt = blob ? blob.uploadedAt.toISOString() : null;

    if (memo && uploadedAt !== null && memo.uploadedAt === uploadedAt) {
      Object.assign(memo, { checkedAt: Date.now(), isStale: false });
      return { snapshot: memo.snapshot, isStale: false };
    }

    let snapshot: LeaderboardSnapshot | null = null;
    if (blob && uploadedAt) {
      const data = await fetchBlobJson<unknown>(blob.url, uploadedAt);
      if (!isValidSnapshot(data, agentType)) {
        throw new Error(`Invalid ${agentType} snapshot uploaded at ${uploadedAt}`);
      }
      snapshot = data;
    }
    snapshotMemo.set(agentType, { snapshot, uploadedAt, checkedAt: Date.now(), isStale: false });
    return { snapshot, isStale: false };
  } catch (error) {
    if (!memo?.snapshot) throw error;
    console.error(`Leaderboard: ${agentType} snapshot read failed, serving the last good`, error);
    Object.assign(memo, {
      checkedAt: Date.now() - SNAPSHOT_MEMO_TTL_MS + SNAPSHOT_RETRY_MS,
      isStale: true,
    });
    return { snapshot: memo.snapshot, isStale: true };
  }
};
