import { describe, expect, it } from 'vitest';
import { IN_LIST_MAX, inListChunks } from './postgrest-in-list';

describe('inListChunks', () => {
  it('cuts a list into pieces of at most 200, in order, losing nothing', () => {
    const values = Array.from({ length: 2 * IN_LIST_MAX + 1 }, (_, n) => n);

    const chunks = inListChunks(values);

    expect(chunks.map((chunk) => chunk.length)).toEqual([200, 200, 1]);
    expect(chunks.flat()).toEqual(values);
  });

  it('keeps a list of exactly 200 whole, and gives no piece for no values', () => {
    expect(inListChunks(Array.from({ length: IN_LIST_MAX }, (_, n) => n))).toHaveLength(1);
    expect(inListChunks([])).toEqual([]);
  });
});
