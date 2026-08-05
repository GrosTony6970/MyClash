import { describe, expect, it } from 'vitest';
import { nextSortState, sortRows } from './SortableHeader';

interface Row {
  name: string;
  score: number | null;
  when: Date | null;
}

const row = (name: string, score: number | null = null, when: Date | null = null): Row => ({
  name,
  score,
  when,
});

const getValue = (r: Row, key: string): unknown =>
  key === 'name' ? r.name : key === 'score' ? r.score : r.when;

describe('sortRows', () => {
  it('returns the same array reference when no sort is active', () => {
    const rows = [row('b'), row('a')];
    expect(sortRows(rows, null, 'asc', getValue)).toBe(rows);
    expect(sortRows(rows, 'name', null, getValue)).toBe(rows);
  });

  it('sorts strings accent- and case-insensitively, with natural numbers', () => {
    const rows = [row('Pool 10'), row('pool 2'), row('Épée')];
    expect(sortRows(rows, 'name', 'asc', getValue).map((r) => r.name)).toEqual([
      'Épée',
      'pool 2',
      'Pool 10',
    ]);
  });

  it('compares numbers and dates by value, not by string', () => {
    const numbers = [row('a', 10), row('b', 2)];
    expect(sortRows(numbers, 'score', 'asc', getValue).map((r) => r.name)).toEqual(['b', 'a']);

    const dates = [row('late', 0, new Date('2027-05-23')), row('early', 0, new Date('2027-05-22'))];
    expect(sortRows(dates, 'when', 'asc', getValue).map((r) => r.name)).toEqual(['early', 'late']);
  });

  it('sinks empty cells in both directions', () => {
    const rows = [row('missing'), row('high', 9), row('low', 1)];
    expect(sortRows(rows, 'score', 'asc', getValue).map((r) => r.name)).toEqual([
      'low',
      'high',
      'missing',
    ]);
    expect(sortRows(rows, 'score', 'desc', getValue).map((r) => r.name)).toEqual([
      'high',
      'low',
      'missing',
    ]);
  });

  it('treats the empty string as missing', () => {
    const rows = [row(''), row('a')];
    expect(sortRows(rows, 'name', 'desc', getValue).map((r) => r.name)).toEqual(['a', '']);
  });

  it('is stable: equal and equally-empty rows keep their input order', () => {
    const rows = [row('m1'), row('m2'), row('tie', 5), row('tie2', 5)];
    expect(sortRows(rows, 'score', 'desc', getValue).map((r) => r.name)).toEqual([
      'tie',
      'tie2',
      'm1',
      'm2',
    ]);
  });
});

describe('nextSortState', () => {
  it('cycles asc → desc → none on the same column', () => {
    expect(nextSortState(null, null, 'name')).toEqual({ key: 'name', direction: 'asc' });
    expect(nextSortState('name', 'asc', 'name')).toEqual({ key: 'name', direction: 'desc' });
    expect(nextSortState('name', 'desc', 'name')).toEqual({ key: null, direction: null });
  });

  it('restarts at asc when another column is clicked', () => {
    expect(nextSortState('name', 'desc', 'score')).toEqual({ key: 'score', direction: 'asc' });
  });
});
