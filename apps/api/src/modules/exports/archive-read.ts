/**
 * archive-read.ts — every row of an archived table whose `column` holds one of `values`.
 *
 * PostgREST cuts an archive short in two ways, and neither says so. One read stops at 1000 rows
 * (`PGRST_DB_MAX_ROWS` in `infra/`): a Tournament of 1,100 hits was archived with 1,000, and its
 * restore and its Exchanges CSV lost the rest. And an `.in()` list travels in the URL, so a long
 * one fails the read. So the values go in pieces of `IN_LIST_MAX`, and each piece is read page by
 * page until a page comes back empty (`READ_PAGE`).
 *
 * The race, named: an organiser downloads the archive while the Event runs, so hits are written and
 * undone between two pages. A table keyed by `id` is read BY KEY: each page starts after the last
 * id read, so a row added or removed meanwhile cannot shift a page onto a row twice (a row twice
 * fails the whole restore on its duplicate id) or past one. The eight tables keyed by several
 * columns (`readOrder`: an Event's skills, instructors, availability, settings) are read by
 * offset: a write to one of them during the download can shift its page. They hold a few rows per
 * Event, far from one page, and are written by an organiser at a desk, not by a pad.
 */
import { BadRequestException } from '@nestjs/common';
import { inListChunks, READ_PAGE } from '../../common/postgrest-in-list';
import type { ArchiveRow } from './archive.table-spec';
import { readOrderFor, type ArchiveTableName } from './archive.tables';

type ReadResult = { data: ArchiveRow[] | null; error: { message: string } | null };

/** The slice of the PostgREST builder a paged read uses. */
export type ReadChain = PromiseLike<ReadResult> & {
  select: (columns: string) => ReadChain;
  eq: (column: string, value: unknown) => ReadChain;
  in: (column: string, values: unknown[]) => ReadChain;
  gt: (column: string, value: unknown) => ReadChain;
  order: (column: string) => ReadChain;
  limit: (count: number) => ReadChain;
  range: (from: number, to: number) => ReadChain;
};

export async function readArchivedRows(
  from: (table: string) => ReadChain,
  table: ArchiveTableName,
  column: string,
  values: readonly unknown[],
): Promise<ArchiveRow[]> {
  const rows: ArchiveRow[] = [];
  // Once each: two pieces naming one value would read its rows twice.
  for (const piece of inListChunks([...new Set(values)])) {
    rows.push(...(await readPiece(from, table, column, piece)));
  }
  return rows;
}

async function readPiece(
  from: (table: string) => ReadChain,
  table: ArchiveTableName,
  column: string,
  piece: readonly unknown[],
): Promise<ArchiveRow[]> {
  const order = readOrderFor(table);
  const byId = order.length === 1 && order[0] === 'id';
  const rows: ArchiveRow[] = [];
  for (;;) {
    const selected = from(table).select('*');
    let query =
      piece.length === 1 ? selected.eq(column, piece[0]) : selected.in(column, [...piece]);
    for (const key of order) query = query.order(key);
    const last = rows.at(-1);
    if (byId && last) query = query.gt('id', last['id']);
    const page = await answered(
      byId ? query.limit(READ_PAGE) : query.range(rows.length, rows.length + READ_PAGE - 1),
    );
    if (page.length === 0) return rows;
    rows.push(...page);
  }
}

async function answered(query: ReadChain): Promise<ArchiveRow[]> {
  const { data, error } = await query;
  if (error) throw new BadRequestException(error.message);
  return data ?? [];
}
