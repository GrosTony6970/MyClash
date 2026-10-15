import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { IN_LIST_MAX } from '../../common/postgrest-in-list';
import { ARCHIVE_PAGE, readArchivedRows, type ReadChain } from './archive-read';
import type { ArchiveRow } from './archive.table-spec';

interface Read {
  table: string;
  filter: [string, string, unknown];
  order: string[];
  range: [number, number] | null;
}

/** A table that answers as PostgREST does: filtered, then cut at `ARCHIVE_PAGE` rows a read. */
function fakeDb(rows: ArchiveRow[], error: { message: string } | null = null) {
  const reads: Read[] = [];
  const from = (table: string): ReadChain => {
    const read: Read = { table, filter: ['', '', null], order: [], range: null };
    reads.push(read);
    let current = rows;
    const chain: ReadChain = {
      select: () => chain,
      eq: (column, value) => {
        read.filter = ['eq', column, value];
        current = current.filter((row) => row[column] === value);
        return chain;
      },
      in: (column, values) => {
        read.filter = ['in', column, values];
        current = current.filter((row) => values.includes(row[column]));
        return chain;
      },
      order: (column) => {
        read.order.push(column);
        return chain;
      },
      range: (start, end) => {
        read.range = [start, end];
        current = current.slice(start, Math.min(end + 1, start + ARCHIVE_PAGE));
        return chain;
      },
      then: (resolve, reject) =>
        Promise.resolve({ data: error ? null : current, error }).then(resolve, reject),
    };
    return chain;
  };
  return { from, reads };
}

const hits = (count: number, matchId = 'match-1') =>
  Array.from({ length: count }, (_, n) => ({ id: `${matchId}-hit-${n}`, match_id: matchId }));

describe('readArchivedRows', () => {
  it('reads past the 1000 rows one read returns', async () => {
    // One bout's hits beyond the cut: before, the archive kept the first 1000 and said nothing.
    const { from, reads } = fakeDb(hits(1005));
    const rows = await readArchivedRows(from, 'exchanges', 'match_id', ['match-1']);
    expect(rows).toHaveLength(1005);
    expect(new Set(rows.map((row) => row['id'])).size).toBe(1005);
    expect(reads.map((read) => read.range)).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    expect(reads[0]!.order).toEqual(['id']);
  });

  it('asks a long list of parents in pieces the URL can carry', async () => {
    const matchIds = Array.from({ length: 450 }, (_, n) => `match-${n}`);
    const { from, reads } = fakeDb(matchIds.flatMap((id) => hits(2, id)));
    const rows = await readArchivedRows(from, 'exchanges', 'match_id', matchIds);
    expect(rows).toHaveLength(900);
    const lists = reads.map((read) => read.filter[2] as string[]);
    expect(lists.map((list) => list.length)).toEqual([IN_LIST_MAX, IN_LIST_MAX, 50]);
    expect(lists.flat()).toEqual(matchIds);
  });

  it('pages a table with no id in the order of its own key', async () => {
    const { from, reads } = fakeDb([{ event_id: 'event-1', person_id: 'p', day: '2026-10-15' }]);
    await readArchivedRows(from, 'event_referee_days', 'event_id', ['event-1']);
    expect(reads[0]!.order).toEqual(['event_id', 'person_id', 'day']);
    expect(reads[0]!.filter).toEqual(['eq', 'event_id', 'event-1']);
  });

  it('reads nothing for no parents', async () => {
    const { from, reads } = fakeDb(hits(3));
    expect(await readArchivedRows(from, 'exchanges', 'match_id', [])).toEqual([]);
    expect(reads).toEqual([]);
  });

  it('fails the archive when a read fails', async () => {
    const { from } = fakeDb([], { message: 'column does not exist' });
    await expect(readArchivedRows(from, 'exchanges', 'match_id', ['m'])).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
