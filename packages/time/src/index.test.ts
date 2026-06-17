import { describe, expect, it } from 'vitest';
import {
  dayStartUtcIso,
  formatInZone,
  minutesIntoDayInZone,
  utcToZonedParts,
  zonedDay,
  zonedToUtcIso,
} from './index';

const PARIS = 'Europe/Paris';
const NY = 'America/New_York';

describe('zonedToUtcIso', () => {
  it('interprets the wall-clock time in the given zone (summer = CEST, UTC+2)', () => {
    // 2027-06-21 is CEST (UTC+2) in Paris → 09:00 local = 07:00 UTC.
    expect(zonedToUtcIso('2027-06-21', '09:00', PARIS)).toBe('2027-06-21T07:00:00.000Z');
  });

  it('handles a different zone (New York summer = EDT, UTC-4)', () => {
    expect(zonedToUtcIso('2027-06-21', '09:00', NY)).toBe('2027-06-21T13:00:00.000Z');
  });

  it('respects DST: winter Paris is CET (UTC+1)', () => {
    expect(zonedToUtcIso('2027-01-15', '09:00', PARIS)).toBe('2027-01-15T08:00:00.000Z');
  });

  it('returns null on malformed input', () => {
    expect(zonedToUtcIso('2027-06-21', '9h', PARIS)).toBeNull();
    expect(zonedToUtcIso('', '09:00', PARIS)).toBeNull();
    expect(zonedToUtcIso('2027-13-01', '09:00', PARIS)).toBeNull();
  });
});

describe('utcToZonedParts / zonedDay', () => {
  it('round-trips a zoned wall-clock through UTC and back', () => {
    const iso = zonedToUtcIso('2027-06-21', '09:00', PARIS)!;
    expect(utcToZonedParts(iso, PARIS)).toEqual({ day: '2027-06-21', hhmm: '09:00' });
    expect(zonedDay(iso, PARIS)).toBe('2027-06-21');
  });

  it('shifts the calendar day when the zone crosses midnight', () => {
    // 00:30 UTC on the 22nd is still the 21st at 20:30 in New York.
    expect(utcToZonedParts('2027-06-22T00:30:00.000Z', NY)).toEqual({
      day: '2027-06-21',
      hhmm: '20:30',
    });
  });
});

describe('minutesIntoDayInZone', () => {
  it('returns minutes since local midnight in the zone', () => {
    const iso = zonedToUtcIso('2027-06-21', '09:30', PARIS)!;
    expect(minutesIntoDayInZone(iso, PARIS)).toBe(570);
  });
});

describe('dayStartUtcIso', () => {
  it('returns the UTC instant of hour:00 on the day in the zone', () => {
    expect(dayStartUtcIso('2027-06-21', PARIS, 8)).toBe('2027-06-21T06:00:00.000Z');
  });
});

describe('formatInZone', () => {
  it('formats in the event zone regardless of host tz', () => {
    const iso = zonedToUtcIso('2027-06-21', '09:00', PARIS)!;
    const out = formatInZone(iso, PARIS, { hour: '2-digit', minute: '2-digit', hour12: false });
    expect(out).toBe('09:00');
  });

  it('returns empty string on bad input', () => {
    expect(formatInZone(null, PARIS, { hour: '2-digit' })).toBe('');
  });
});
