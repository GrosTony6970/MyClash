import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { IN_LIST_MAX } from '../../common/postgrest-in-list';
import { readArchivedRows, type ReadChain } from './archive-read';
import type { ArchiveRow } from './archive.table-spec';

interface Read {
  filter: [string, string, unknown];
  keep: (row: ArchiveRow) => boolean;
  order: string[];
  after: unknown;
  count: number;
  window: [number, number] | null;
}

const newRead = (): Read => ({
  filter: ['', '', null],
  keep: () => true,
  order: [],
  after: undefined,
  count: Infinity,
  window: null,
});

/** What PostgREST answers `read` of `rows`: filtered, sorted, after the key, cut at `cap`. */
function pageOf(rows: ArchiveRow[], read: Read, cap: number): ArchiveRow[] {
  const key = (row: ArchiveRow) => read.order.map((column) => String(row[column])).join('|');
  const sorted = rows.filter(read.keep).sort((a, b) => key(a).localeCompare(key(b)));
  const after = read.after;
  const past =
    after === undefined ? sorted : sorted.filter((row) => String(row['id']) > String(after));
  const [start, end] = read.window ?? [0, Infinity];
  return past.slice(start, Math.min(end + 1, start + read.count, start + cap));
}

/**
 * A table that answers as PostgREST does (`pageOf`). `between` runs after each read: a write that
 * lands while the download goes on.
 */
function fakeDb(
  rows: ArchiveRow[],
  { cap = 1000, error = null as { message: string } | null, between = () => {} } = {},
) {
  const reads: Read[] = [];
  const from = (): ReadChain => {
    const read = newRead();
    reads.push(read);
    const chain: ReadChain = {
      select: () => chain,
      eq: (column, value) => {
        read.filter = ['eq', column, value];
        read.keep = (row) => row[column] === value;
        return chain;
      },
      in: (column, values) => {
        read.filter = ['in', column, values];
        read.keep = (row) => values.includes(row[column]);
        return chain;
      },
      gt: (_column, value) => {
        read.after = value;
        return chain;
      },
      order: (column) => {
        read.order.push(column);
        return chain;
      },
      limit: (n) => {
        read.count = n;
        return chain;
      },
      range: (start, end) => {
        read.window = [start, end];
        return chain;
      },
      then: (resolve, reject) => {
        const page = pageOf(rows, read, cap);
        between();
        return Promise.resolve({ data: error ? null : page, error }).then(resolve, reject);
      },
    };
    return chain;
  };
  return { from, reads };
}

const hit = (n: number, matchId = 'match-1') => ({
  id: `${matchId}-hit-${String(n).padStart(4, '0')}`,
  match_id: matchId,
});
const hits = (count: number, matchId = 'match-1') =>
  Array.from({ length: count }, (_, n) => hit(n, matchId));

describe('readArchivedRows', () => {
  it('reads past the 1000 rows one read returns, each page after the last id', async () => {
    // One bout's hits beyond the cut: before, the archive kept the first 1000 and said nothing.
    const { from, reads } = fakeDb(hits(1005));
    const rows = await readArchivedRows(from, 'exchanges', 'match_id', ['match-1']);
    expect(rows).toHaveLength(1005);
    expect(new Set(rows.map((row) => row['id'])).size).toBe(1005);
    expect(reads.map((read) => read.after)).toEqual([
      undefined,
      'match-1-hit-0999',
      'match-1-hit-1004',
    ]);
    expect(reads[0]!.order).toEqual(['id']);
  });

  it('reads every row when the server cuts a read shorter than a page', async () => {
    const { from } = fakeDb(hits(1005), { cap: 400 });
    expect(await readArchivedRows(from, 'exchanges', 'match_id', ['match-1'])).toHaveLength(1005);
  });

  it('a hit written or undone during the download moves no row onto a second page', async () => {
    // Live Event: between two pages a pad adds a hit whose id sorts first, and an undo removes one.
    // By offset, the page edge would then be read twice (a restore fails on the duplicate id).
    const rows: ArchiveRow[] = hits(1500);
    let writes = 0;
    const { from } = fakeDb(rows, {
      between: () => {
        if (writes++ > 0) return;
        rows.unshift({ id: 'match-1-hit-+', match_id: 'match-1' });
        rows.splice(rows.length - 1, 1);
      },
    });
    const read = await readArchivedRows(from, 'exchanges', 'match_id', ['match-1']);
    expect(new Set(read.map((row) => row['id'])).size).toBe(read.length);
    expect(read).toHaveLength(1499);
  });

  it('asks a long list of parents in pieces the URL can carry, each value once', async () => {
    const matchIds = Array.from({ length: 450 }, (_, n) => `match-${n}`);
    const { from, reads } = fakeDb(matchIds.flatMap((id) => hits(2, id)));
    const rows = await readArchivedRows(from, 'exchanges', 'match_id', [...matchIds, 'match-0']);
    expect(rows).toHaveLength(900);
    const lists = reads
      .filter((read) => read.after === undefined)
      .map((r) => r.filter[2] as string[]);
    expect(lists.map((list) => list.length)).toEqual([IN_LIST_MAX, IN_LIST_MAX, 50]);
    expect(lists.flat()).toEqual(matchIds);
  });

  it('pages a table with no id in the order of its own key', async () => {
    const days = [{ event_id: 'event-1', person_id: 'p', day: '2026-10-15' }];
    const { from, reads } = fakeDb(days);
    const rows = await readArchivedRows(from, 'event_referee_days', 'event_id', ['event-1']);
    expect(rows).toEqual(days);
    expect(reads[0]!.order).toEqual(['event_id', 'person_id', 'day']);
    expect(reads.map((read) => read.window)).toEqual([
      [0, 999],
      [1, 1000],
    ]);
    expect(reads[0]!.filter).toEqual(['eq', 'event_id', 'event-1']);
  });

  it('reads nothing for no parents', async () => {
    const { from, reads } = fakeDb(hits(3));
    expect(await readArchivedRows(from, 'exchanges', 'match_id', [])).toEqual([]);
    expect(reads).toEqual([]);
  });

  it('fails the archive when a read fails', async () => {
    const { from } = fakeDb([], { error: { message: 'column does not exist' } });
    await expect(readArchivedRows(from, 'exchanges', 'match_id', ['m'])).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
