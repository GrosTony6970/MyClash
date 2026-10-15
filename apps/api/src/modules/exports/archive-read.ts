/**
 * archive-read.ts — every row of an archived table whose `column` holds one of `values`.
 *
 * PostgREST cuts an archive short in two ways, and neither says so. One read stops at
 * `ARCHIVE_PAGE` rows (`PGRST_DB_MAX_ROWS` in `infra/`): a Tournament of 1,100 hits was archived
 * with 1,000, and its restore and its Exchanges CSV lost the rest. And an `.in()` list travels in
 * the URL, so a long one fails the read. So the values go in pieces of `IN_LIST_MAX`, and each
 * piece is read page by page in the table's own key order (`readOrderFor`): a full page asks for
 * the next.
 */
import { BadRequestException } from '@nestjs/common';
import { inListChunks } from '../../common/postgrest-in-list';
import type { ArchiveRow } from './archive.table-spec';
import { readOrderFor, type ArchiveTableName } from './archive.tables';

/** PostgREST's cut of one read. */
export const ARCHIVE_PAGE = 1000;

type ReadResult = { data: ArchiveRow[] | null; error: { message: string } | null };

/** The slice of the PostgREST builder a paged read uses. */
export type ReadChain = PromiseLike<ReadResult> & {
  select: (columns: string) => ReadChain;
  eq: (column: string, value: unknown) => ReadChain;
  in: (column: string, values: unknown[]) => ReadChain;
  order: (column: string) => ReadChain;
  range: (from: number, to: number) => ReadChain;
};

export async function readArchivedRows(
  from: (table: string) => ReadChain,
  table: ArchiveTableName,
  column: string,
  values: readonly unknown[],
): Promise<ArchiveRow[]> {
  const rows: ArchiveRow[] = [];
  for (const piece of inListChunks(values)) {
    for (let start = 0; ; start += ARCHIVE_PAGE) {
      const page = await readPage(from(table), table, column, piece, start);
      rows.push(...page);
      if (page.length < ARCHIVE_PAGE) break;
    }
  }
  return rows;
}

async function readPage(
  query: ReadChain,
  table: ArchiveTableName,
  column: string,
  piece: readonly unknown[],
  start: number,
): Promise<ArchiveRow[]> {
  const selected = query.select('*');
  let page = piece.length === 1 ? selected.eq(column, piece[0]) : selected.in(column, [...piece]);
  for (const key of readOrderFor(table)) page = page.order(key);
  const { data, error } = await page.range(start, start + ARCHIVE_PAGE - 1);
  if (error) throw new BadRequestException(error.message);
  return data ?? [];
}
