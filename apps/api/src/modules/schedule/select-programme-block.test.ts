import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MATCH_DURATION_MINUTES,
  dayIndexFor,
  selectProgrammeBlocks,
  toHHMM,
} from './select-programme-block';

const block = (startTime: string, endTime: string, id = startTime) => ({ id, startTime, endTime });

describe('dayIndexFor', () => {
  const day = 24 * 60 * 60 * 1000;
  const start = Date.parse('2026-07-21T00:00:00Z');

  it('is 0 on the opening day', () => {
    expect(dayIndexFor('2026-07-21T00:00:00Z', start + 6 * 60 * 60 * 1000)).toBe(0);
  });

  it('advances one per elapsed day', () => {
    expect(dayIndexFor('2026-07-21T00:00:00Z', start + 2 * day)).toBe(2);
  });

  it('clamps to 0 before the event starts', () => {
    // A future start date must show the first day's programme, not a negative
    // index that matches no block at all.
    expect(dayIndexFor('2026-07-21T00:00:00Z', start - 5 * day)).toBe(0);
  });

  it('falls back to 0 for a missing or unparseable start date', () => {
    expect(dayIndexFor(null, start)).toBe(0);
    expect(dayIndexFor(undefined, start)).toBe(0);
    expect(dayIndexFor('not a date', start)).toBe(0);
  });
});

describe('selectProgrammeBlocks', () => {
  const blocks = [block('09:00', '12:00', 'morning'), block('13:00', '17:00', 'afternoon')];

  it('picks the block containing now, and the next one due', () => {
    const { current, next } = selectProgrammeBlocks(blocks, '10:30');
    expect(current?.id).toBe('morning');
    expect(next?.id).toBe('afternoon');
  });

  it('has no current block between blocks, but still knows what is next', () => {
    const { current, next } = selectProgrammeBlocks(blocks, '12:30');
    expect(current).toBeNull();
    expect(next?.id).toBe('afternoon');
  });

  it('has neither once the day is over', () => {
    expect(selectProgrammeBlocks(blocks, '18:00')).toEqual({ current: null, next: null });
  });

  it('treats block boundaries as inclusive on both ends', () => {
    expect(selectProgrammeBlocks(blocks, '09:00').current?.id).toBe('morning');
    expect(selectProgrammeBlocks(blocks, '12:00').current?.id).toBe('morning');
  });

  it('tolerates HH:MM:SS times from Postgres', () => {
    expect(selectProgrammeBlocks([block('09:00:00', '12:00:00')], '09:30').current).not.toBeNull();
  });

  it('takes the FIRST block starting after now as next', () => {
    const three = [...blocks, block('18:00', '20:00', 'evening')];
    expect(selectProgrammeBlocks(three, '08:00').next?.id).toBe('morning');
  });

  it('has no current or next block when the day is empty', () => {
    expect(selectProgrammeBlocks([], '10:00')).toEqual({ current: null, next: null });
  });
});

describe('toHHMM', () => {
  it('zero-pads both fields so the string compare stays valid', () => {
    expect(toHHMM(new Date(2026, 6, 21, 9, 5))).toBe('09:05');
    expect(toHHMM(new Date(2026, 6, 21, 14, 30))).toBe('14:30');
  });
});

describe('DEFAULT_MATCH_DURATION_MINUTES', () => {
  it('matches the event_programme_blocks column default', () => {
    expect(DEFAULT_MATCH_DURATION_MINUTES).toBe(5);
  });
});
