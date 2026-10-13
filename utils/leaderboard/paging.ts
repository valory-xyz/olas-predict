/** Pure cursor-paging helpers for the leaderboard fetchers (no `skip`, so no indexer limit). */

export type TimestampedRow = { id: string; timestamp: number };

export type TimestampPaging<T> = {
  /** Every row with `timestampGt < timestamp <= syncedTo`, oldest first */
  rows: T[];
  /** The cursor to resume from: every row up to this timestamp has been fetched */
  syncedTo: number;
  /** `false` when `isPastDeadline` stopped the paging before the newest row */
  complete: boolean;
};

const maxTimestamp = (rows: TimestampedRow[], floor: number) =>
  rows.reduce((max, { timestamp }) => Math.max(max, timestamp), floor);

/**
 * Pages rows sorted by a timestamp that is not unique (several rows can share a block), with a
 * timestamp cursor instead of `skip`. A full page may cut the rows of its last timestamp, so
 * those are re-read in full by id before the cursor moves past them: no row is fetched twice
 * or skipped at a page boundary, and `syncedTo` only ever covers complete timestamps.
 *
 * Stops between pages once `isPastDeadline()`, returning what is complete so far.
 */
export const pageByTimestamp = async <T extends TimestampedRow>({
  timestampGt,
  pageSize,
  isPastDeadline,
  fetchAfter,
  fetchAt,
}: {
  timestampGt: number;
  pageSize: number;
  isPastDeadline: () => boolean;
  /** Up to `pageSize` rows with a timestamp above `timestampGt`, oldest first */
  fetchAfter: (timestampGt: number) => Promise<T[]>;
  /** Up to `pageSize` rows with exactly `timestamp` and an id above `idGt`, by id */
  fetchAt: (timestamp: number, idGt: string) => Promise<T[]>;
}): Promise<TimestampPaging<T>> => {
  const rows: T[] = [];
  let syncedTo = timestampGt;
  for (;;) {
    if (isPastDeadline()) return { rows, syncedTo, complete: false };
    const page = await fetchAfter(syncedTo);
    if (page.length < pageSize) {
      rows.push(...page);
      return { rows, syncedTo: maxTimestamp(page, syncedTo), complete: true };
    }

    const lastTimestamp = page[page.length - 1].timestamp;
    const before = page.filter(({ timestamp }) => timestamp < lastTimestamp);
    const group: T[] = [];
    for (let idGt = ''; ; ) {
      if (isPastDeadline()) {
        rows.push(...before);
        return {
          rows,
          syncedTo: maxTimestamp(before, syncedTo),
          complete: false,
        };
      }
      const groupPage = await fetchAt(lastTimestamp, idGt);
      group.push(...groupPage);
      if (groupPage.length < pageSize) break;
      idGt = groupPage[groupPage.length - 1].id;
    }
    rows.push(...before, ...group);
    syncedTo = lastTimestamp;
  }
};

/**
 * Pages rows sorted by a unique id with an `id_gt` cursor. Stops between pages once
 * `isPastDeadline()`; `complete` is `false` then and `rows` holds only part of the result.
 */
export const pageById = async <T extends { id: string }>({
  pageSize,
  isPastDeadline,
  fetchPage,
}: {
  pageSize: number;
  isPastDeadline: () => boolean;
  fetchPage: (idGt: string) => Promise<T[]>;
}): Promise<{ rows: T[]; complete: boolean }> => {
  const rows: T[] = [];
  for (let idGt = ''; ; ) {
    if (isPastDeadline()) return { rows, complete: false };
    const page = await fetchPage(idGt);
    rows.push(...page);
    if (page.length < pageSize) return { rows, complete: true };
    idGt = page[page.length - 1].id;
  }
};
