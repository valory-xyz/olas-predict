/** Pure cursor-paging helper for the leaderboard fetchers (no `skip`, so no indexer limit). */

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
