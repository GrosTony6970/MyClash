import { describe, it, expect } from 'vitest';
import type { ProgrammeBlock } from '@myclash/types';
import { nextBlockStartTime, resequenceDay } from './programme-timeline';

function block(p: Partial<ProgrammeBlock> & { id: string }): ProgrammeBlock {
  return {
    eventId: 'e1',
    dayIndex: 0,
    sortOrder: 0,
    blockType: 'admin',
    label: '',
    competitionId: null,
    competitionPhase: null,
    workshopId: null,
    liceCount: 0,
    startTime: '09:00',
    endTime: '09:30',
    matchGapSeconds: 0,
    matchDurationMinutes: 0,
    colorHex: null,
    generatedAt: null,
    ...p,
  };
}

describe('nextBlockStartTime', () => {
  it('returns the day start when the day has no blocks', () => {
    expect(nextBlockStartTime([], 0, '08:00')).toBe('08:00');
  });

  it("returns the last block's end time for the day", () => {
    const blocks = [
      block({ id: 'a', startTime: '09:00', endTime: '10:30' }),
      block({ id: 'b', startTime: '10:30', endTime: '11:00' }),
    ];
    expect(nextBlockStartTime(blocks, 0, '08:00')).toBe('11:00');
  });

  it('only considers blocks on the requested day', () => {
    const blocks = [
      block({ id: 'a', dayIndex: 0, startTime: '09:00', endTime: '10:00' }),
      block({ id: 'b', dayIndex: 1, startTime: '14:00', endTime: '15:00' }),
    ];
    expect(nextBlockStartTime(blocks, 1, '08:00')).toBe('15:00');
  });
});

describe('resequenceDay', () => {
  it('re-flows reordered blocks back-to-back, preserving durations + earliest start', () => {
    // Reordered so B (30min) now precedes A (90min); earliest start is 09:00.
    const blocks = [
      block({ id: 'b', sortOrder: 0, startTime: '10:30', endTime: '11:00' }),
      block({ id: 'a', sortOrder: 1, startTime: '09:00', endTime: '10:30' }),
    ];
    const out = resequenceDay(blocks, 0, '08:00');
    expect(out.map((b) => [b.id, b.startTime, b.endTime])).toEqual([
      ['b', '09:00', '09:30'],
      ['a', '09:30', '11:00'],
    ]);
  });

  it('collapses a gap so blocks run contiguously', () => {
    const blocks = [
      block({ id: 'a', startTime: '09:00', endTime: '10:00' }),
      block({ id: 'b', startTime: '11:00', endTime: '11:30' }),
    ];
    const out = resequenceDay(blocks, 0, '08:00');
    expect(out.map((b) => [b.startTime, b.endTime])).toEqual([
      ['09:00', '10:00'],
      ['10:00', '10:30'],
    ]);
  });

  it('leaves blocks on other days untouched', () => {
    const blocks = [
      block({ id: 'a', dayIndex: 0, startTime: '09:00', endTime: '10:00' }),
      block({ id: 'x', dayIndex: 1, startTime: '08:15', endTime: '09:45' }),
    ];
    const out = resequenceDay(blocks, 0, '08:00');
    const x = out.find((b) => b.id === 'x')!;
    expect([x.startTime, x.endTime]).toEqual(['08:15', '09:45']);
  });

  it('returns the input unchanged for an empty day', () => {
    const blocks = [block({ id: 'a', dayIndex: 0 })];
    expect(resequenceDay(blocks, 5, '08:00')).toBe(blocks);
  });
});
