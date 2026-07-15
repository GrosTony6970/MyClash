import { describe, expect, it } from 'vitest';
import {
  dayStartUtcIso,
  formatDate,
  formatDateRange,
  formatInZone,
  formatTime,
  localeToBcp47,
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

  it('forces 24-hour even for a 12-hour locale (en-US)', () => {
    const iso = zonedToUtcIso('2027-06-21', '14:30', PARIS)!;
    expect(formatInZone(iso, PARIS, { hour: '2-digit', minute: '2-digit' }, 'en-US')).toBe('14:30');
  });

  it('respects an explicit hour12: true override', () => {
    const iso = zonedToUtcIso('2027-06-21', '14:30', PARIS)!;
    const out = formatInZone(
      iso,
      PARIS,
      { hour: 'numeric', minute: '2-digit', hour12: true },
      'en-US',
    );
    expect(out).toMatch(/PM/);
  });
});

describe('localeToBcp47', () => {
  it('maps app locales to BCP-47 tags (en → en-GB, fr → fr-FR)', () => {
    expect(localeToBcp47('en')).toBe('en-GB');
    expect(localeToBcp47('fr')).toBe('fr-FR');
  });
});

describe('locale-aware formatters', () => {
  const iso = zonedToUtcIso('2027-06-21', '14:30', PARIS)!; // 12:30 UTC

  it('formatDate renders month name in the UI locale (event tz)', () => {
    expect(formatDate(iso, 'en', undefined, PARIS)).toBe('21 Jun 2027');
    expect(formatDate(iso, 'fr', undefined, PARIS)).toMatch(/21 juin 2027/);
  });

  it('formatTime renders the event-zone wall clock in 24h', () => {
    expect(formatTime(iso, 'en', undefined, PARIS)).toBe('14:30');
    expect(formatTime(iso, 'fr', undefined, PARIS)).toBe('14:30');
  });

  it('formatTime without tz uses the viewer local zone (still 24h)', () => {
    // No tz → host zone; just assert 24h HH:MM shape, no AM/PM.
    expect(formatTime(iso, 'en')).toMatch(/^\d{2}:\d{2}$/);
  });

  it('formatDate returns empty string on bad input', () => {
    expect(formatDate(null, 'en')).toBe('');
    expect(formatDate('not-a-date', 'fr')).toBe('');
  });

  it('formatDateRange collapses a same-day range and joins distinct days', () => {
    const startIso = zonedToUtcIso('2027-06-21', '09:00', PARIS)!;
    const endIso = zonedToUtcIso('2027-06-23', '18:00', PARIS)!;
    expect(formatDateRange(startIso, startIso, 'en', undefined, PARIS)).toBe('21 Jun 2027');
    expect(formatDateRange(startIso, endIso, 'en', undefined, PARIS)).toBe(
      '21 Jun 2027 – 23 Jun 2027',
    );
  });

  it('formatDateRange falls back to whichever endpoint exists', () => {
    const startIso = zonedToUtcIso('2027-06-21', '09:00', PARIS)!;
    expect(formatDateRange(startIso, null, 'en', undefined, PARIS)).toBe('21 Jun 2027');
    expect(formatDateRange(null, startIso, 'en', undefined, PARIS)).toBe('21 Jun 2027');
    expect(formatDateRange(null, null, 'en')).toBe('');
  });
});
