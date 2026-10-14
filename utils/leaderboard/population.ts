/**
 * Sanity check of a run's sources against the previous run, before the builder prunes its
 * working state and publishes: an indexer that answers `200` with fewer rows (re-indexing
 * behind the same URL, a proxy pointing at a version that is still syncing) would otherwise
 * delete the state of every agent missing from the answer and publish a board built from the
 * subset.
 */

/** What the last accepted run saw, and how many runs in a row were refused since */
export type PopulationRecord = {
  /** Block (Omen) or squid height (Polymarket) of the sources */
  sourceHeight: number | null;
  /** Agents of the type with activity in the longest window */
  activeAgents: number;
  /** Those of them known to be Pearl agents */
  pearlAgents: number;
  suspectRuns: number;
};

/** Blocks the source height may go back by (reorgs) */
export const SOURCE_HEIGHT_TOLERANCE = 100;
/** Largest share of the active or Pearl agents that may disappear from one run to the next */
export const MAX_POPULATION_DROP = 0.2;
/** A drop seen this many runs in a row is taken as real, so a lasting change can't stall the board */
export const ACCEPT_POPULATION_DROP_AFTER_RUNS = 3;

const dropped = (previous: number, current: number) =>
  previous > 0 && current < previous * (1 - MAX_POPULATION_DROP);

/** Why `current` looks like a partial answer compared with `previous`, or `null` */
export const getPopulationDrop = (
  previous: Omit<PopulationRecord, 'suspectRuns'>,
  current: Omit<PopulationRecord, 'suspectRuns'>,
): string | null => {
  if (
    previous.sourceHeight !== null &&
    current.sourceHeight !== null &&
    current.sourceHeight < previous.sourceHeight - SOURCE_HEIGHT_TOLERANCE
  ) {
    return `source height went back from ${previous.sourceHeight} to ${current.sourceHeight}`;
  }
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
 * publish. A drop is refused `ACCEPT_POPULATION_DROP_AFTER_RUNS - 1` runs in a row and then
 * accepted (`accepted` names it, for the log). Without a previous record there is nothing to
 * compare with.
 */
export const checkPopulation = (
  previous: PopulationRecord | undefined,
  current: Omit<PopulationRecord, 'suspectRuns'>,
): { record: PopulationRecord; refusal: string | null; accepted: string | null } => {
  const drop = previous ? getPopulationDrop(previous, current) : null;
  if (!previous || !drop)
    return { record: { ...current, suspectRuns: 0 }, refusal: null, accepted: null };
  const suspectRuns = previous.suspectRuns + 1;
  if (suspectRuns >= ACCEPT_POPULATION_DROP_AFTER_RUNS) {
    return { record: { ...current, suspectRuns: 0 }, refusal: null, accepted: drop };
  }
  return { record: { ...previous, suspectRuns }, refusal: drop, accepted: null };
};

/** Thrown by the builder for a refused run; the refresh reports the type as failed */
export class PopulationDropError extends Error {}
