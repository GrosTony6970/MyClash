import { describe, expect, it } from 'vitest';
import { shiftBreaksAfterOverlap } from './shift-breaks';

// Minutes-of-day blocks for one day; competition match windows in minutes.
describe('shiftBreaksAfterOverlap', () => {
  it('pushes a break that overlaps competition matches to the latest overlapping match end', () => {
    const result = shiftBreaksAfterOverlap(
      [{ id: 'lunch', dayIndex: 0, blockType: 'break', startMin: 720, endMin: 780 }], // 12:00–13:00
      // a pool match running 11:50–12:20 on day 0
      { 0: [{ startMin: 710, endMin: 740 }] },
    );
    // Break shifted to start at 12:20 (740), keeps its 60-min duration → 13:20.
    expect(result).toEqual([
      { id: 'lunch', dayIndex: 0, blockType: 'break', startMin: 740, endMin: 800 },
    ]);
  });

  it('leaves a non-overlapping break untouched', () => {
    const result = shiftBreaksAfterOverlap(
      [{ id: 'lunch', dayIndex: 0, blockType: 'break', startMin: 720, endMin: 780 }],
      { 0: [{ startMin: 600, endMin: 660 }] }, // 10:00–11:00, ends before the break
    );
    expect(result[0]!.startMin).toBe(720);
    expect(result[0]!.endMin).toBe(780);
  });

  it('cascades: a second break that the shifted first break now overlaps moves too', () => {
    const result = shiftBreaksAfterOverlap(
      [
        { id: 'b1', dayIndex: 0, blockType: 'break', startMin: 720, endMin: 750 }, // 12:00–12:30
        { id: 'b2', dayIndex: 0, blockType: 'break', startMin: 760, endMin: 790 }, // 12:40–13:10
      ],
      { 0: [{ startMin: 710, endMin: 740 }] }, // match 11:50–12:20
    );
    // b1 → 12:20–12:50 (740–770); b2 now overlaps b1 (740..770) so → 12:50–13:20 (770–800).
    expect(result).toEqual([
      { id: 'b1', dayIndex: 0, blockType: 'break', startMin: 740, endMin: 770 },
      { id: 'b2', dayIndex: 0, blockType: 'break', startMin: 770, endMin: 800 },
    ]);
  });

  it('only considers matches on the same day', () => {
    const result = shiftBreaksAfterOverlap(
      [{ id: 'lunch', dayIndex: 1, blockType: 'break', startMin: 720, endMin: 780 }],
      { 0: [{ startMin: 710, endMin: 740 }] }, // overlap is on day 0, break is day 1
    );
    expect(result[0]!.startMin).toBe(720);
  });

  it('passes non-break blocks through unchanged', () => {
    const result = shiftBreaksAfterOverlap(
      [{ id: 'pool', dayIndex: 0, blockType: 'competition', startMin: 700, endMin: 760 }],
      { 0: [{ startMin: 710, endMin: 740 }] },
    );
    expect(result).toEqual([
      { id: 'pool', dayIndex: 0, blockType: 'competition', startMin: 700, endMin: 760 },
    ]);
  });
});
