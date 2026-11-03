import { describe, expect, it } from 'vitest';
import { boardClock, selectProgrammeBlocks } from './select-programme-block';

const block = (startTime: string, endTime: string, id = startTime) => ({ id, startTime, endTime });

/** The board's day and "HH:MM" on the Event's wall clock (ruling 411), whatever the server's. */
describe('boardClock', () => {
  const at = (nowIso: string, timezone: unknown, firstDay: string | null = '2026-11-07') => {
    const { dayIndex, hhmm } = boardClock(nowIso, firstDay, timezone);
    return `day ${dayIndex} ${hhmm}`;
  };

  it('reads a New York Event on the New York clock and calendar', () => {
    expect(at('2026-11-07T15:00:00Z', 'America/New_York')).toBe('day 0 10:00');
    // Already the next day in UTC and in Paris: still day 0 in New York.
    expect(at('2026-11-08T01:00:00Z', 'America/New_York')).toBe('day 0 20:00');
    expect(at('2026-11-08T05:30:00Z', 'America/New_York')).toBe('day 1 00:30');
  });

  it('reads a Tokyo Event on the Tokyo clock and calendar', () => {
    // Still the day before in UTC.
    expect(at('2026-11-06T23:30:00Z', 'Asia/Tokyo')).toBe('day 0 08:30');
    expect(at('2026-11-07T16:00:00Z', 'Asia/Tokyo')).toBe('day 1 01:00');
  });

  it("turns a Paris Event's day at Paris midnight, in winter and in summer", () => {
    expect(at('2026-11-07T23:30:00Z', 'Europe/Paris')).toBe('day 1 00:30');
    expect(at('2026-07-11T22:30:00Z', 'Europe/Paris', '2026-07-11')).toBe('day 1 00:30');
  });

  it('names the zone it read', () => {
    expect(boardClock('2026-11-07T15:00:00Z', '2026-11-07', 'Asia/Tokyo')).toMatchObject({
      zone: 'Asia/Tokyo',
      unknownZone: false,
    });
  });

  it.each([['Mars/Olympus'], [null], [undefined], ['local']])(
    'reads an unknown zone %j on the Paris clock, and says so',
    (timezone) => {
      expect(boardClock('2026-11-07T08:30:00Z', '2026-11-07', timezone)).toEqual({
        dayIndex: 0,
        hhmm: '09:30',
        zone: 'Europe/Paris',
        unknownZone: true,
        unknownFirstDay: false,
      });
    },
  );

  it('clamps to day 0 before the Event starts', () => {
    // A future start date must show the first day's programme, not a negative
    // index that matches no block at all.
    expect(at('2026-11-01T15:00:00Z', 'America/New_York')).toBe('day 0 10:00');
  });

  it('falls back to day 0 for a missing or unparseable start date, and says so', () => {
    expect(at('2026-11-09T15:00:00Z', 'America/New_York', null)).toBe('day 0 10:00');
    expect(at('2026-11-09T15:00:00Z', 'America/New_York', 'not a date')).toBe('day 0 10:00');
    const flag = (firstDay: string | null) =>
      boardClock('2026-11-09T15:00:00Z', firstDay, 'America/New_York').unknownFirstDay;
    expect([flag(null), flag('not a date'), flag('2026-11-07')]).toEqual([true, true, false]);
  });

  it('reads the date of a start date given as a full instant', () => {
    expect(at('2026-11-09T15:00:00Z', 'America/New_York', '2026-11-07T00:00:00.000Z')).toBe(
      'day 2 10:00',
    );
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
