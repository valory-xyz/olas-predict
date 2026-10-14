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
import type { PopulationRecord } from './population';
import { isRecord, isValidBuilderState, isValidSnapshot } from './validate';

/** How long a warm function trusts its in-memory snapshot before checking Blob again */
const SNAPSHOT_MEMO_TTL_MS = 60_000;
/** After a failed read, how soon the last good snapshot is checked against Blob again */
const SNAPSHOT_RETRY_MS = 10_000;
/** How soon a client's newer `snapshot` may trigger another Blob check of the memo */
const SNAPSHOT_MIN_RECHECK_MS = 5_000;
/** Shortest edge cache Blob allows, so a rewritten snapshot is visible within a minute */
const BLOB_CACHE_MAX_AGE_SECONDS = 60;
/**
 * Time limits on Blob calls. The SDK retries a 5xx or network error up to 10 times with
 * back-off (17 to 34 min; `VERCEL_BLOB_RETRIES` lowers it project-wide), so without a limit a
 * Blob outage would hang every request past the function limit instead of falling back to the
 * last good snapshot.
 */
const BLOB_HEAD_TIMEOUT_MS = 5_000;
const SNAPSHOT_DOWNLOAD_TIMEOUT_MS = 10_000;
/** The working state is tens of MB */
const STATE_DOWNLOAD_TIMEOUT_MS = 45_000;
const BLOB_PUT_TIMEOUT_MS = 45_000;

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
  /** When this state started from empty (epoch ms); absent in states saved before it existed */
  createdAt?: number;
  /** What the last accepted run's sources held (see `population.ts`); absent before it existed */
  population?: PopulationRecord;
};

export const createEmptyState = (): BuilderState => ({
  schemaVersion: LEADERBOARD_STATE_SCHEMA_VERSION,
  pearl: {},
  mech: {},
  tallies: {},
  titles: {},
  pendingMarkets: {},
  createdAt: Date.now(),
});

const getSnapshotPath = (agentType: AgentType) =>
  `${LEADERBOARD_BLOB_PREFIX}/${agentType}/snapshot.json`;

const getStatePath = (agentType: AgentType) =>
  `${LEADERBOARD_BLOB_PREFIX}/${agentType}/builder-state.json`;

// The SDK's error classes do not set `name`, so match on the class
const isNotFound = (error: unknown) => error instanceof BlobNotFoundError;

/** A Blob read that came back incomplete or not as JSON: a failed read, never "start over" */
export class BlobReadError extends Error {}

/**
 * Runs a Blob SDK call and rejects once `timeoutMs` passes. The SDK notices an abort only
 * between its retries, so the call is aborted (which stops further retries) and the race
 * rejects at once.
 */
export const withBlobTimeout = async <T>(
  what: string,
  timeoutMs: number,
  call: (abortSignal: AbortSignal) => Promise<T>,
): Promise<T> => {
  const controller = new AbortController();
  const pending = call(controller.signal);
  // Its rejection after a timeout is expected and handled by the race below
  pending.catch(() => {});
  let timer: Parameters<typeof clearTimeout>[0];
  try {
    return await Promise.race([
      pending,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error(`Blob ${what} timed out after ${timeoutMs} ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

/** Blob metadata, or `null` when the blob does not exist */
const headBlob = async (pathname: string) => {
  try {
    return await withBlobTimeout(`head of ${pathname}`, BLOB_HEAD_TIMEOUT_MS, (abortSignal) =>
      head(pathname, { abortSignal }),
    );
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
};

/**
 * The JSON body of a blob `head` described. A body whose byte length differs from the blob's
 * `size`, or that is not served as JSON, throws `BlobReadError` (an HTML error page, an empty or
 * cut body), so only a complete body that fails to parse throws a `SyntaxError`.
 */
export const fetchBlobJson = async <T>(
  blob: { url: string; uploadedAt: Date; size: number },
  timeoutMs: number,
): Promise<T> => {
  // The query string bypasses the edge cache of the previous version
  const url = `${blob.url}?v=${encodeURIComponent(blob.uploadedAt.toISOString())}`;
  const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`Blob read failed: HTTP ${response.status} for ${blob.url}`);
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    throw new BlobReadError(
      `Blob read of ${blob.url} returned ${contentType || 'no content type'}`,
    );
  }
  const body = new Uint8Array(await response.arrayBuffer());
  if (body.byteLength !== blob.size) {
    throw new BlobReadError(
      `Blob read of ${blob.url} returned ${body.byteLength} of ${blob.size} bytes`,
    );
  }
  return JSON.parse(new TextDecoder().decode(body)) as T;
};

const writeJsonBlob = async (pathname: string, data: unknown) => {
  const body = JSON.stringify(data);
  await withBlobTimeout(`write of ${pathname}`, BLOB_PUT_TIMEOUT_MS, (abortSignal) =>
    put(pathname, body, {
      access: 'public',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: 'application/json',
      cacheControlMaxAge: BLOB_CACHE_MAX_AGE_SECONDS,
      abortSignal,
    }),
  );
};

/**
 * The saved working state, or an empty one when there is none, it has an older schema, or a
 * complete body is unreadable (not JSON, wrong shape), so a bad save cannot make every refresh
 * fail. A failed or incomplete Blob read throws: starting over then would overwrite a good state.
 */
export const readBuilderState = async (agentType: AgentType): Promise<BuilderState> => {
  const blob = await headBlob(getStatePath(agentType));
  if (!blob) return createEmptyState();
  let state: unknown;
  try {
    state = await fetchBlobJson<unknown>(blob, STATE_DOWNLOAD_TIMEOUT_MS);
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
  /** Until when the memo is trusted without a Blob check (epoch ms) */
  freshUntil: number;
  /** The last read failed, so `snapshot` is the last good one */
  isStale: boolean;
};
const snapshotMemo = new Map<AgentType, MemoEntry>();
/** When the last Blob check of each type started, whatever its outcome (epoch ms) */
const lastCheckStartedAt = new Map<AgentType, number>();
/** The Blob check in progress per type, which concurrent requests share */
const checksInFlight = new Map<AgentType, Promise<SnapshotRead>>();

/** Forgets every memoized snapshot; for tests */
export const resetSnapshotMemo = () => {
  snapshotMemo.clear();
  lastCheckStartedAt.clear();
  checksInFlight.clear();
};

export type SnapshotRead = {
  /** `null` when no snapshot exists yet */
  snapshot: LeaderboardSnapshot | null;
  /** Blob could not be read (or held an invalid snapshot): this is the last good snapshot */
  isStale: boolean;
};

const checkBlobSnapshot = async (agentType: AgentType): Promise<SnapshotRead> => {
  const memo = snapshotMemo.get(agentType);
  try {
    const blob = await headBlob(getSnapshotPath(agentType));
    const uploadedAt = blob ? blob.uploadedAt.toISOString() : null;

    if (memo && uploadedAt !== null && memo.uploadedAt === uploadedAt) {
      Object.assign(memo, { freshUntil: Date.now() + SNAPSHOT_MEMO_TTL_MS, isStale: false });
      return { snapshot: memo.snapshot, isStale: false };
    }

    let snapshot: LeaderboardSnapshot | null = null;
    if (blob && uploadedAt) {
      const data = await fetchBlobJson<unknown>(blob, SNAPSHOT_DOWNLOAD_TIMEOUT_MS);
      if (!isValidSnapshot(data, agentType)) {
        throw new Error(`Invalid ${agentType} snapshot uploaded at ${uploadedAt}`);
      }
      snapshot = data;
    }
    snapshotMemo.set(agentType, {
      snapshot,
      uploadedAt,
      freshUntil: Date.now() + SNAPSHOT_MEMO_TTL_MS,
      isStale: false,
    });
    return { snapshot, isStale: false };
  } catch (error) {
    if (!memo?.snapshot) throw error;
    console.error(`Leaderboard: ${agentType} snapshot read failed, serving the last good`, error);
    Object.assign(memo, { freshUntil: Date.now() + SNAPSHOT_RETRY_MS, isStale: true });
    return { snapshot: memo.snapshot, isStale: true };
  }
};

/**
 * The current snapshot for an agent type. Memoized per warm function and only re-downloaded
 * when Blob has a newer one; concurrent requests share one Blob check. `minUpdatedAt` skips the
 * memo when it is older than that (a client already saw a newer snapshot on another instance),
 * at most once per `SNAPSHOT_MIN_RECHECK_MS` from the start of the last check, failed or not.
 * An older or equal `minUpdatedAt` is answered from the memo, without a Blob request.
 *
 * A snapshot that fails validation (wrong shape, schema version or agent type) counts as a
 * failed read. When a read fails, the last good snapshot this function holds is served, marked
 * stale, and Blob is checked again shortly; without one, the error is thrown. Every Blob call
 * is time-limited, so an outage answers within seconds.
 */
export const readSnapshot = async (
  agentType: AgentType,
  { minUpdatedAt }: { minUpdatedAt?: string } = {},
): Promise<SnapshotRead> => {
  const now = Date.now();
  const memo = snapshotMemo.get(agentType);
  const isMemoOlder =
    !!minUpdatedAt &&
    !!memo?.snapshot &&
    memo.snapshot.updatedAt < minUpdatedAt &&
    now - (lastCheckStartedAt.get(agentType) ?? -Infinity) >= SNAPSHOT_MIN_RECHECK_MS;
  if (memo && !isMemoOlder && now < memo.freshUntil) {
    return { snapshot: memo.snapshot, isStale: memo.isStale };
  }

  const inFlight = checksInFlight.get(agentType);
  if (inFlight) return inFlight;
  lastCheckStartedAt.set(agentType, now);
  const check = checkBlobSnapshot(agentType).finally(() => checksInFlight.delete(agentType));
  checksInFlight.set(agentType, check);
  return check;
};
