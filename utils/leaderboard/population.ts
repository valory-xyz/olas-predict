/**
 * Sanity check of a run's sources against the previous run, before the builder prunes its
 * working state and publishes: an indexer that answers `200` with fewer rows (re-indexing
 * behind the same URL, a proxy pointing at a version that is still syncing) would otherwise
 * delete the state of every agent missing from the answer and publish a board built from the
 * subset.
 */

/** What the last accepted run saw, and since when runs have been refused for a drop */
export type PopulationRecord = {
  /** Block (Omen) or squid height (Polymarket) of the sources */
  sourceHeight: number | null;
  /** Agents of the type with activity in the longest window */
  activeAgents: number;
  /** Those of them known to be Pearl agents */
  pearlAgents: number;
  /**
   * When the agent counts were first seen to drop (epoch ms), while the drop lasts; `null` (or
   * absent, in states saved before it existed) otherwise
   */
  suspectSince?: number | null;
};

type PopulationCounts = Omit<PopulationRecord, 'suspectSince'>;

/** Blocks the source height may go back by (reorgs) */
export const SOURCE_HEIGHT_TOLERANCE = 100;
/** Largest share of the active or Pearl agents that may disappear from one run to the next */
export const MAX_POPULATION_DROP = 0.2;
/**
 * A drop in the agent counts seen for this long (with a source height that did not go back) is
 * taken as real, so a lasting change can't stall the board. Measured in time rather than runs,
 * so manual refreshes cannot shorten it.
 */
export const ACCEPT_POPULATION_DROP_AFTER_MS = 24 * 60 * 60 * 1000;

const dropped = (previous: number, current: number) =>
  previous > 0 && current < previous * (1 - MAX_POPULATION_DROP);

/** Why the source height of `current` is behind `previous` (an indexer re-syncing), or `null` */
const getHeightDrop = (previous: PopulationCounts, current: PopulationCounts) =>
  previous.sourceHeight !== null &&
  current.sourceHeight !== null &&
  current.sourceHeight < previous.sourceHeight - SOURCE_HEIGHT_TOLERANCE
    ? `source height went back from ${previous.sourceHeight} to ${current.sourceHeight}`
    : null;

/** Why `current` looks like a partial answer compared with `previous`, or `null` */
export const getPopulationDrop = (
  previous: PopulationCounts,
  current: PopulationCounts,
): string | null => {
  const heightDrop = getHeightDrop(previous, current);
  if (heightDrop) return heightDrop;
  if (dropped(previous.activeAgents, current.activeAgents)) {
    return `active agents dropped from ${previous.activeAgents} to ${current.activeAgents}`;
  }
  if (dropped(previous.pearlAgents, current.pearlAgents)) {
    return `Pearl agents dropped from ${previous.pearlAgents} to ${current.pearlAgents}`;
  }
  return null;
};

/**
 * The record to store after this run, and `refusal` when the run must neither prune nor
 * publish. Without a previous record there is nothing to compare with.
 *
 * - A source height that went back is always refused, until the source reaches the stored
 *   height again: a stuck indexer keeps failing loudly, one that catches up passes on its own.
 * - No Pearl agents left, when the last accepted run had some, is always refused: the board is
 *   never emptied (nor the state pruned to nothing) by one answer.
 * - Any other drop is refused until it has lasted `ACCEPT_POPULATION_DROP_AFTER_MS` from the
 *   first run that saw it, then accepted (`accepted` names it, for the log).
 */
export const checkPopulation = (
  previous: PopulationRecord | undefined,
  current: PopulationCounts,
  now: number,
): { record: PopulationRecord; refusal: string | null; accepted: string | null } => {
  const accept = (accepted: string | null = null) => ({
    record: { ...current, suspectSince: null },
    refusal: null,
    accepted,
  });
  const drop = previous ? getPopulationDrop(previous, current) : null;
  if (!previous || !drop) return accept();
  const refuse = (refusal: string, suspectSince: number | null) => ({
    record: { ...previous, suspectSince },
    refusal,
    accepted: null,
  });
  // The clock of a count drop starts once the source has caught up, not while it re-syncs
  if (getHeightDrop(previous, current)) {
    return refuse(`${drop}; waiting for it to reach ${previous.sourceHeight} again`, null);
  }
  const suspectSince = previous.suspectSince ?? now;
  if (previous.pearlAgents > 0 && current.pearlAgents === 0) {
    return refuse(`${drop}; a board without Pearl agents is never published`, suspectSince);
  }
  if (now - suspectSince >= ACCEPT_POPULATION_DROP_AFTER_MS) return accept(drop);
  return refuse(drop, suspectSince);
};

/** Thrown by the builder for a refused run; the refresh reports the type as failed */
export class PopulationDropError extends Error {}
