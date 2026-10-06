import { ascendingWithNumbers } from '@myclash/ui';
import { describe, expect, it } from 'vitest';
import { newestOf, type Scored } from './newest-entry';

/**
 * The undo takes back the last line of the bout's list. The list's order is
 * `ascendingWithNumbers` of the UI package; `newestOf` states it again for the
 * queue's store. These hold the two together.
 */
const row = (name: string, occurredAt: string, sequence: number) => ({
  name,
  occurredAt,
  sequence,
});
type Row = ReturnType<typeof row>;

const scored = (entry: Row): Scored => entry;
const lastLine = (rows: Row[]) =>
  ascendingWithNumbers(rows.map((entry) => ({ ...entry, seq: entry.sequence }))).at(-1)?.name;

const CASES: Record<string, Row[]> = {
  'the later time wins over the higher sequence': [
    row('late', '2026-10-06T10:30:00.000Z', 1),
    row('early', '2026-10-06T10:05:00.000Z', 9),
  ],
  'one instant: the higher sequence': [
    row('second', '2026-10-06T10:05:00.000Z', 2),
    row('first', '2026-10-06T10:05:00.000Z', 1),
  ],
  'one instant written two ways': [
    row('raw', '2026-10-06 10:05:00+00', 1),
    row('iso', '2026-10-06T10:05:00.000Z', 2),
  ],
  'a time nobody can read sorts last': [
    row('unreadable', 'not a time', 1),
    row('read', '2026-10-06T10:05:00.000Z', 2),
  ],
  'two unreadable times: the higher sequence': [row('b', '', 2), row('a', 'not a time', 1)],
  'one row': [row('only', '2026-10-06T10:05:00.000Z', 1)],
};

describe('newestOf', () => {
  it.each(Object.entries(CASES))('%s', (_name, rows) => {
    const newest = newestOf(rows, scored)?.name;

    expect(newest).toBe(lastLine(rows));
    expect(newestOf([...rows].reverse(), scored)?.name, 'in any order of the rows').toBe(newest);
  });

  it('names the row, for the cases above', () => {
    expect(Object.values(CASES).map((rows) => newestOf(rows, scored)?.name)).toEqual([
      'late',
      'second',
      'iso',
      'unreadable',
      'b',
      'only',
    ]);
  });

  it('answers undefined for no row', () => {
    expect(newestOf([], scored)).toBeUndefined();
  });
});
