import { describe, expect, it } from 'vitest';
import type { PenaltyRulesetEntry } from '../hooks/usePenalties';
import { quickEntriesOf, searchedEntries, sortedEntries } from './penalty-entries';

/** An entry as the API sends it: `ref_number` is TEXT since migration 0071. */
const entry = (id: string, group: number, ref: string): PenaltyRulesetEntry => ({
  id,
  group_number: group,
  ref_number: ref,
  short_name: id,
  description: `${id}, in full`,
  sanctions: ['yellow'],
});

describe('sortedEntries', () => {
  it('puts "2" before "10" inside a group, and keeps a letter ref', () => {
    const sorted = sortedEntries([
      entry('ten', 1, '10'),
      entry('r7a', 1, 'R7a'),
      entry('two', 1, '2'),
      entry('eight', 1, '8'),
    ]);
    expect(sorted.map((e) => e.id)).toEqual(['two', 'eight', 'ten', 'r7a']);
  });

  it('sorts by group first', () => {
    const sorted = sortedEntries([entry('b', 2, '1'), entry('a', 1, '9'), entry('c', 1, 'R1')]);
    expect(sorted.map((e) => e.id)).toEqual(['a', 'c', 'b']);
  });

  it('leaves the list it was given as it was', () => {
    const list = [entry('ten', 1, '10'), entry('two', 1, '2')];
    sortedEntries(list);
    expect(list.map((e) => e.id)).toEqual(['ten', 'two']);
  });
});

describe('searchedEntries', () => {
  const entries = [entry('late', 1, '8'), entry('rude', 1, 'R7a'), entry('seven', 1, '7')];

  it('finds a letter ref typed in either case', () => {
    expect(searchedEntries(entries, 'r7a').map((e) => e.id)).toEqual(['rude']);
    expect(searchedEntries(entries, 'R7a').map((e) => e.id)).toEqual(['rude']);
  });

  it('finds by a digit of the ref, and by name and description', () => {
    expect(searchedEntries(entries, '7').map((e) => e.id)).toEqual(['rude', 'seven']);
    expect(searchedEntries(entries, 'LATE').map((e) => e.id)).toEqual(['late']);
  });

  it('shows the whole list for an empty search', () => {
    expect(searchedEntries(entries, '  ')).toEqual(entries);
  });
});

describe('quickEntriesOf', () => {
  const entries = [entry('late', 1, '8'), entry('rude', 1, 'R7a'), entry('other', 1, '9')];

  it('finds the entries pinned by their ref as text', () => {
    expect(quickEntriesOf(entries, ['R7a', '8']).map((e) => e.id)).toEqual(['late', 'rude']);
  });

  it('finds none when nothing is pinned', () => {
    expect(quickEntriesOf(entries, [])).toEqual([]);
    expect(quickEntriesOf(entries, undefined)).toEqual([]);
  });
});
