import { Settings } from 'luxon';
import { afterEach, describe, expect, it } from 'vitest';
import { zonedToUtcIso } from './index';

/**
 * A wall time the clocks pass twice (the night they go back) resolves to the EARLIER instant
 * (ruling 413), whatever today's date is. Luxon alone answers from the offset in force "now", so
 * the same question gave a different instant in July and in November. The earlier instant is the
 * one V8's `setHours` gives, so a server that used it keeps its answers.
 */
const realNow = Settings.now;
afterEach(() => {
  Settings.now = realNow;
});

const WINTER = '2026-11-03T12:00:00Z';
const SUMMER = '2026-07-01T12:00:00Z';

function at(now: string, day: string, hhmm: string, zone: string): string | null {
  Settings.now = () => Date.parse(now);
  return zonedToUtcIso(day, hhmm, zone);
}

describe('zonedToUtcIso: a wall time that happens twice', () => {
  for (const [season, now] of [
    ['winter', WINTER],
    ['summer', SUMMER],
  ] as const) {
    it(`Paris 02:30 on 2026-10-25 is the first 02:30, asked in ${season}`, () => {
      expect(at(now, '2026-10-25', '02:30', 'Europe/Paris')).toBe('2026-10-25T00:30:00.000Z');
    });

    it(`New York 01:30 on 2026-11-01 is the first 01:30, asked in ${season}`, () => {
      expect(at(now, '2026-11-01', '01:30', 'America/New_York')).toBe('2026-11-01T05:30:00.000Z');
    });

    it(`Lord Howe 01:45 on 2027-04-04 (a 30-minute change) is the first one, asked in ${season}`, () => {
      expect(at(now, '2027-04-04', '01:45', 'Australia/Lord_Howe')).toBe(
        '2027-04-03T14:45:00.000Z',
      );
    });

    it(`Troll 02:30 on 2026-10-25 (a two-hour change) is the first one, asked in ${season}`, () => {
      expect(at(now, '2026-10-25', '02:30', 'Antarctica/Troll')).toBe('2026-10-25T00:30:00.000Z');
    });

    it(`Havana's repeated midnight on 2026-11-01 starts the day at the first one, asked in ${season}`, () => {
      expect(at(now, '2026-11-01', '00:00', 'America/Havana')).toBe('2026-11-01T04:00:00.000Z');
    });

    it(`the minutes either side of the repeated hour are left alone, asked in ${season}`, () => {
      expect(at(now, '2026-10-25', '01:59', 'Europe/Paris')).toBe('2026-10-24T23:59:00.000Z');
      expect(at(now, '2026-10-25', '03:00', 'Europe/Paris')).toBe('2026-10-25T02:00:00.000Z');
      expect(at(now, '2026-10-25', '10:00', 'Europe/Paris')).toBe('2026-10-25T09:00:00.000Z');
    });

    it(`the spring gap is unchanged: 02:30 Paris on 2027-03-28 moves forward, asked in ${season}`, () => {
      expect(at(now, '2027-03-28', '02:30', 'Europe/Paris')).toBe('2027-03-28T01:30:00.000Z');
      expect(at(now, '2027-03-28', '03:30', 'Europe/Paris')).toBe('2027-03-28T01:30:00.000Z');
    });
  }
});
