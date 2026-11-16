/**
 * Every row of a PostgREST read, page after page, by key (ruling 831). PostgREST cuts a read at
 * `PGRST_DB_MAX_ROWS` (1000) and says nothing, so a read that wants every row asks again after
 * the last id it got, until a page comes back EMPTY (`READ_PAGE`, postgrest-in-list.ts).
 *
 * By key, not by offset: a row written or removed between two pages cannot push another row onto
 * a second page or past one. A row inserted whose id sorts BEHIND the cursor is not read by this
 * pass; it waits for the next one.
 *
 * The caller builds each page: `.order('id')`, `.gt('id', after)` only once a row was read (page 1
 * sends no cursor), and `.limit(READ_PAGE)`. This owner keeps the cursor, stops on an empty page,
 * and refuses what would make it loop or read a row twice: a row without an id (its cursor would
 * be "undefined"), and an id it already returned. A read that forgot `.order('id')` can still skip
 * rows without repeating one: only the caller's order prevents that, and each caller's test pins
 * it. Ids are not compared by order here: a text id is ordered by the database's collation, not by
 * JavaScript's.
 *
 * Other loops in the API still page by hand (exports, spar-find, workshop booked people, the photo
 * download, pg-aggregate by range): they are not this owner's callers yet.
 */

/** A PostgREST answer to one page. */
export interface PageAnswer<T> {
  data: T[] | null;
  error: { message: string } | null;
}

/** PostgREST refused a page: the caller decides what its reader sees. */
export class PageReadFailed extends Error {
  override name = 'PageReadFailed';
}

export async function readEveryRowById<T extends Record<string, unknown>>(
  page: (after: string | undefined) => PromiseLike<PageAnswer<T>>,
  opts: { shouldStop?: () => boolean } = {},
): Promise<{ rows: T[]; stopped: boolean }> {
  const rows: T[] = [];
  const seen = new Set<string>();
  let after: string | undefined;
  for (;;) {
    if (opts.shouldStop?.()) return { rows, stopped: true };
    const { data, error } = await page(after);
    if (error) throw new PageReadFailed(error.message);
    const batch = data ?? [];
    if (batch.length === 0) return { rows, stopped: false };
    for (const row of batch) {
      const id = row['id'];
      if (id === null || id === undefined) throw new Error('A paged read got a row without an id');
      const key = String(id);
      if (seen.has(key)) {
        throw new Error(`A paged read got the row ${key} twice: is it ordered by id?`);
      }
      seen.add(key);
      rows.push(row);
    }
    after = String(batch.at(-1)!['id']);
  }
}
