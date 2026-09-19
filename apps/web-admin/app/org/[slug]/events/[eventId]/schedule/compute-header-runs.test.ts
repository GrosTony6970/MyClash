import { describe, expect, it } from 'vitest';
import { computeHeaderRuns, type HeaderRunItem } from './compute-header-runs';

/** A match on row lines: its minutes are its rows × 5. */
const item = (
  id: string,
  key: string,
  slot: number,
  over: Partial<HeaderRunItem> = {},
): HeaderRunItem => {
  const drawn = { id, key, liceIndex: 0, slot, span: 2, restMinutes: 0, ...over };
  return { atMinutes: drawn.slot * 5, lengthMinutes: drawn.span * 5, ...drawn };
};

/** A Pool bout by its exact minutes, drawn the way the board draws it: floored rows. */
const bout = (
  id: string,
  atMinutes: number,
  lengthMinutes: number,
  restMinutes = 0,
): HeaderRunItem => ({
  id,
  key: 'pool-1',
  liceIndex: 0,
  slot: Math.floor(atMinutes / 5),
  span: Math.max(1, Math.floor(lengthMinutes / 5)),
  atMinutes,
  lengthMinutes,
  restMinutes,
});

describe('computeHeaderRuns', () => {
  it('folds back-to-back same-key matches on one lice into a single run', () => {
    const runs = computeHeaderRuns([
      item('m1', 'pool-1', 0),
      item('m2', 'pool-1', 2),
      item('m3', 'pool-1', 4),
    ]);

    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      key: 'pool-1',
      liceIndex: 0,
      startSlot: 0,
      endSlot: 6,
      matchIds: ['m1', 'm2', 'm3'],
    });
  });

  it('splits the run when a time gap separates same-key matches', () => {
    const runs = computeHeaderRuns([
      item('m1', 'pool-1', 0),
      item('m2', 'pool-1', 2),
      item('m3', 'pool-1', 10),
    ]);

    expect(runs).toHaveLength(2);
    expect(runs[0]!.matchIds).toEqual(['m1', 'm2']);
    expect(runs[1]).toMatchObject({ startSlot: 10, endSlot: 12, matchIds: ['m3'] });
  });

  it('splits around a different-key match wedged into the run', () => {
    const runs = computeHeaderRuns([
      item('a1', 'LSW|SF', 0),
      item('other', 'LSW|F', 2),
      item('a2', 'LSW|SF', 4),
    ]);

    expect(runs.map((r) => r.key)).toEqual(['LSW|SF', 'LSW|F', 'LSW|SF']);
    expect(runs.map((r) => r.matchIds)).toEqual([['a1'], ['other'], ['a2']]);
  });

  it('keeps one run per lice for the same key', () => {
    const runs = computeHeaderRuns([
      item('m1', 'pool-1', 0, { liceIndex: 0 }),
      item('m2', 'pool-1', 0, { liceIndex: 1 }),
    ]);

    expect(runs).toHaveLength(2);
    expect(runs.map((r) => r.liceIndex)).toEqual([0, 1]);
  });

  it('keeps a Pool of 8-minute bouts in one run, though its drawn rows have holes', () => {
    // 10:43, 10:51 … 11:23 on an 08:00 axis: drawn on rows 32, 34, 35, 37, 39, 40.
    const starts = [163, 171, 179, 187, 195, 203];
    const runs = computeHeaderRuns(starts.map((at, i) => bout(`m${i + 1}`, at, 8)));

    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ startSlot: 32, endSlot: 41 });
    expect(runs[0]!.matchIds).toEqual(['m1', 'm2', 'm3', 'm4', 'm5', 'm6']);
    // The skipped rows are no rest: the bouts are back to back.
    expect(runs[0]!.rests).toEqual([]);
  });

  it("keeps a Pool the server laid with the sheet's 10-second gap in one run", () => {
    const runs = computeHeaderRuns([
      bout('m1', 120, 5),
      bout('m2', 125 + 10 / 60, 5),
      bout('m3', 130 + 20 / 60, 5),
    ]);

    expect(runs.map((r) => r.matchIds)).toEqual([['m1', 'm2', 'm3']]);
    expect(runs[0]!.rests).toEqual([]);
  });

  it('closes the run at a gap of one whole row, and not before', () => {
    const joined = computeHeaderRuns([bout('a', 0, 5), bout('b', 9.5, 5)]);
    const split = computeHeaderRuns([bout('a', 0, 5), bout('b', 10, 5)]);

    expect(joined.map((r) => r.matchIds)).toEqual([['a', 'b']]);
    expect(split.map((r) => r.matchIds)).toEqual([['a'], ['b']]);
  });

  it('keeps a Pool in one run across its own rest, and reports the rest', () => {
    // As the server lays it: 5-minute bouts, 10 s apart, the 10-minute rest
    // after the third. Bout 3 ends at 135⅓ (drawn to row 27); bout 4 starts at
    // 145½ (row 29).
    const starts = [120, 125 + 1 / 6, 130 + 1 / 3, 145.5, 150 + 2 / 3, 155 + 5 / 6];
    const runs = computeHeaderRuns(starts.map((at, i) => bout(`m${i + 1}`, at, 5, 10)));

    expect(runs).toHaveLength(1);
    expect(runs[0]!.matchIds).toHaveLength(6);
    expect(runs[0]!.rests).toEqual([{ startSlot: 27, endSlot: 29, minutes: 10 }]);
  });

  it('closes the run at a gap longer than the rest and a row, and not before', () => {
    const joined = computeHeaderRuns([bout('a', 0, 5, 10), bout('b', 19.9, 5, 10)]);
    const split = computeHeaderRuns([bout('a', 0, 5, 10), bout('b', 20, 5, 10)]);

    expect(joined.map((r) => r.matchIds)).toEqual([['a', 'b']]);
    expect(split.map((r) => r.matchIds)).toEqual([['a'], ['b']]);
    expect(split.flatMap((r) => r.rests)).toEqual([]);
  });

  it("splits at a gap the operator made that is shorter than the Pool's rest", () => {
    // Seven minutes of nothing, and the Pool rests ten: not its rest.
    const runs = computeHeaderRuns([bout('a', 0, 5, 10), bout('b', 12, 5, 10)]);

    expect(runs.map((r) => r.matchIds)).toEqual([['a'], ['b']]);
    expect(runs.flatMap((r) => r.rests)).toEqual([]);
  });

  it('draws no rest where the rest leaves no row empty', () => {
    // 3-minute bouts draw one whole row each: 'a' is drawn to 00:05 and ends at
    // 00:03; 'b' starts after the 5-minute rest, at 00:08, on the next row.
    const runs = computeHeaderRuns([bout('a', 0, 3, 5), bout('b', 8, 3, 5)]);

    expect(runs.map((r) => r.matchIds)).toEqual([['a', 'b']]);
    expect(runs[0]!.rests).toEqual([]);
  });

  it('extends the run through overlapping same-key matches (conflict layout)', () => {
    const runs = computeHeaderRuns([item('m1', 'pool-1', 0, { span: 4 }), item('m2', 'pool-1', 2)]);

    expect(runs).toHaveLength(1);
    expect(runs[0]!.endSlot).toBe(4);
  });
});
