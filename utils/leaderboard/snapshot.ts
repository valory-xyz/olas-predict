/**
 * Server-only storage of the leaderboard in Vercel Blob: one snapshot per agent type, which
 * the public endpoints read, and the builder's working state, which only the refresh route
 * reads and writes. Uses the runtime-only `BLOB_READ_WRITE_TOKEN`.
 */
import { BlobNotFoundError, head, put } from '@vercel/blob';

import { AgentType } from 'constants/index';
import {
  LEADERBOARD_BLOB_PREFIX,
  LEADERBOARD_SNAPSHOT_SCHEMA_VERSION,
  LEADERBOARD_STATE_SCHEMA_VERSION,
} from 'constants/leaderboard';
import type { LeaderboardSnapshot } from 'types/leaderboard';

import type { PearlLookup } from './pearl';

/** How long a warm function trusts its in-memory snapshot before checking Blob again */
const SNAPSHOT_MEMO_TTL_MS = 60_000;
/** Shortest edge cache Blob allows, so a rewritten snapshot is visible within a minute */
const BLOB_CACHE_MAX_AGE_SECONDS = 60;

export type BuilderState = {
  schemaVersion: number;
  /** Pearl flag lookup per service id */
  pearl: Record<string, PearlLookup>;
  /** Per agent: mech requests as [title key, timestamp], and the newest timestamp fetched */
  mech: Record<string, { syncedTo: number; requests: [string, number][] }>;
  /** Per agent: [won, counted bets, buy cost in USD] per market with a final answer */
  tallies: Record<string, Record<string, [number, number, number]>>;
  /** Polymarket question id -> title key (Omen titles come with the daily statistics) */
  titles: Record<string, string>;
};

export const createEmptyState = (): BuilderState => ({
  schemaVersion: LEADERBOARD_STATE_SCHEMA_VERSION,
  pearl: {},
  mech: {},
  tallies: {},
  titles: {},
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

export const readBuilderState = async (agentType: AgentType): Promise<BuilderState> => {
  const blob = await headBlob(getStatePath(agentType));
  if (!blob) return createEmptyState();
  const state = await fetchBlobJson<BuilderState>(blob.url, blob.uploadedAt.toISOString());
  return state.schemaVersion === LEADERBOARD_STATE_SCHEMA_VERSION ? state : createEmptyState();
};

export const writeBuilderState = (agentType: AgentType, state: BuilderState) =>
  writeJsonBlob(getStatePath(agentType), state);

export const writeSnapshot = (snapshot: LeaderboardSnapshot) =>
  writeJsonBlob(getSnapshotPath(snapshot.agentType), snapshot);

type MemoEntry = {
  snapshot: LeaderboardSnapshot | null;
  uploadedAt: string | null;
  checkedAt: number;
};
const snapshotMemo = new Map<AgentType, MemoEntry>();

/**
 * The current snapshot for an agent type, or `null` when none exists yet or it has an unknown
 * schema version. Memoized per warm function and only re-downloaded when Blob has a newer one.
 * Throws when Blob cannot be read.
 */
export const readSnapshot = async (agentType: AgentType): Promise<LeaderboardSnapshot | null> => {
  const memo = snapshotMemo.get(agentType);
  if (memo && Date.now() - memo.checkedAt < SNAPSHOT_MEMO_TTL_MS) return memo.snapshot;

  const blob = await headBlob(getSnapshotPath(agentType));
  const uploadedAt = blob ? blob.uploadedAt.toISOString() : null;

  if (memo && uploadedAt !== null && memo.uploadedAt === uploadedAt) {
    memo.checkedAt = Date.now();
    return memo.snapshot;
  }

  const data =
    blob && uploadedAt ? await fetchBlobJson<LeaderboardSnapshot>(blob.url, uploadedAt) : null;
  const snapshot = data?.schemaVersion === LEADERBOARD_SNAPSHOT_SCHEMA_VERSION ? data : null;
  snapshotMemo.set(agentType, { snapshot, uploadedAt, checkedAt: Date.now() });
  return snapshot;
};
