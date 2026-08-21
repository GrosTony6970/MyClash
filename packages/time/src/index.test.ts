import { describe, expect, it } from 'vitest';
import {
  calendarGapBetweenDays,
  dayIndexInZone,
  dayStartUtcIso,
  formatCalendarGap,
  formatDate,
  formatDateRange,
  formatDayCount,
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

describe('calendarGapBetweenDays', () => {
  it('splits a long gap into whole years/months/days', () => {
    // 2026-08-06 + 26505 days — the unreadable day count that motivated this.
    expect(calendarGapBetweenDays('2026-08-06', '2099-03-01')).toEqual({
      direction: 1,
      years: 72,
      months: 6,
      days: 23,
    });
  });

  it('uses real month lengths, not a 30-day approximation', () => {
    // One calendar month is 28 days here and 31 days there; both are "1 month".
    expect(calendarGapBetweenDays('2026-02-01', '2026-03-01')).toMatchObject({
      years: 0,
      months: 1,
      days: 0,
    });
    expect(calendarGapBetweenDays('2026-03-01', '2026-04-01')).toMatchObject({
      years: 0,
      months: 1,
      days: 0,
    });
  });

  it('counts the leap day in a leap year', () => {
    expect(calendarGapBetweenDays('2028-02-28', '2028-02-29')).toMatchObject({
      months: 0,
      days: 1,
    });
    // 2027 has no 29 Feb, so the same wall-clock span is a day shorter.
    expect(calendarGapBetweenDays('2027-02-28', '2027-03-01')).toMatchObject({
      months: 0,
      days: 1,
    });
  });

  it('reports direction 0 for the same day', () => {
    expect(calendarGapBetweenDays('2026-08-06', '2026-08-06')).toEqual({
      direction: 0,
      years: 0,
      months: 0,
      days: 0,
    });
  });

  it('reports a past day as direction -1 with non-negative magnitudes', () => {
    expect(calendarGapBetweenDays('2026-08-06', '2026-06-20')).toEqual({
      direction: -1,
      years: 0,
      months: 1,
      days: 17,
    });
  });

  it('returns null on missing or malformed input', () => {
    expect(calendarGapBetweenDays(null, '2026-08-06')).toBeNull();
    expect(calendarGapBetweenDays('2026-08-06', undefined)).toBeNull();
    expect(calendarGapBetweenDays('', '2026-08-06')).toBeNull();
    expect(calendarGapBetweenDays('06/08/2026', '2026-08-06')).toBeNull();
    expect(calendarGapBetweenDays('2026-13-01', '2026-08-06')).toBeNull();
  });
});

/**
 * CLDR separates a number from its unit with a no-break space in French, and
 * does it inconsistently per unit ("3 ans" plain, "3 mois" NBSP). That's
 * correct typography and renders as a space; pinning the exact codepoint would
 * make these tests hostage to a CLDR bump, so compare on the wording instead.
 */
const spaces = (value: string) => value.replace(/[  ]/g, ' ');

describe('formatCalendarGap', () => {
  const gapTo = (day: string) => calendarGapBetweenDays('2026-08-06', day)!;

  it('renders the two largest units of a multi-year gap', () => {
    expect(spaces(formatCalendarGap(gapTo('2099-03-01'), 'en'))).toBe('72 years, 6 months');
    expect(spaces(formatCalendarGap(gapTo('2099-03-01'), 'fr'))).toBe('72 ans et 6 mois');
  });

  it('truncates to two units, dropping the smallest', () => {
    // 1 year, 1 month, 22 days → the days are noise at that scale.
    expect(spaces(formatCalendarGap(gapTo('2027-09-28'), 'en'))).toBe('1 year, 1 month');
  });

  it('drops a trailing zero unit rather than printing "0 months"', () => {
    expect(spaces(formatCalendarGap(gapTo('2027-08-11'), 'en'))).toBe('1 year');
  });

  it('falls to months and days under a year', () => {
    expect(spaces(formatCalendarGap(gapTo('2026-09-22'), 'en'))).toBe('1 month, 16 days');
    expect(spaces(formatCalendarGap(gapTo('2026-09-22'), 'fr'))).toBe('1 mois et 16 jours');
  });

  it('stays in plain days under a month', () => {
    expect(spaces(formatCalendarGap(gapTo('2026-08-24'), 'en'))).toBe('18 days');
    expect(spaces(formatCalendarGap(gapTo('2026-08-24'), 'fr'))).toBe('18 jours');
  });

  it('pluralizes per locale — the whole reason "day(s)" is gone', () => {
    expect(spaces(formatCalendarGap(gapTo('2026-08-07'), 'en'))).toBe('1 day');
    expect(spaces(formatCalendarGap(gapTo('2026-08-07'), 'fr'))).toBe('1 jour');
  });

  it('renders a zero gap as days rather than an empty string', () => {
    expect(spaces(formatCalendarGap(gapTo('2026-08-06'), 'en'))).toBe('0 days');
  });

  it('ignores direction — the caller supplies the before/after wording', () => {
    const future = gapTo('2026-09-22');
    const past = calendarGapBetweenDays('2026-08-06', '2026-06-20')!;
    expect(spaces(formatCalendarGap(future, 'en'))).toBe('1 month, 16 days');
    expect(spaces(formatCalendarGap(past, 'en'))).toBe('1 month, 17 days');
  });
});

describe('formatDayCount', () => {
  it('uses the locale plural form', () => {
    expect(spaces(formatDayCount(1, 'en'))).toBe('1 day');
    expect(spaces(formatDayCount(3, 'en'))).toBe('3 days');
    expect(spaces(formatDayCount(1, 'fr'))).toBe('1 jour');
    expect(spaces(formatDayCount(3, 'fr'))).toBe('3 jours');
  });
});

describe('dayIndexInZone', () => {
  // Two zones on opposite sides of UTC, one shared instant. A server-clock
  // implementation cannot tell them apart, so the DIFFERENCE is the assertion.
  const KIRITIMATI = 'Pacific/Kiritimati'; // UTC+14, no DST
  const INSTANT = '2026-05-21T22:00:00Z';
  const START = '2026-05-21';

  it('reads the day boundary in the event zone, not the runner zone', () => {
    // 22:00Z is 12:00 on the 22nd in Kiritimati and 18:00 on the 21st in NY.
    expect(dayIndexInZone(INSTANT, START, KIRITIMATI)).toBe(1);
    expect(dayIndexInZone(INSTANT, START, NY)).toBe(0);
  });

  it('counts calendar days, so a DST change does not shift the index', () => {
    // 2026-03-29 is the last Sunday of March: Paris springs forward, and that
    // day is 23 hours long. The instant is 00:30 on the 30th, Paris time — two
    // calendar days after the 28th, but only 47.5 hours after local midnight on
    // the 28th, which elapsed-hours arithmetic floors to day 1.
    expect(dayIndexInZone('2026-03-29T22:30:00Z', '2026-03-28', PARIS)).toBe(2);
  });

  it('clamps a date before the start day to 0 rather than going negative', () => {
    expect(dayIndexInZone('2026-05-19T08:00:00Z', START, PARIS)).toBe(0);
  });

  it('returns null rather than falling back to the system zone', () => {
    expect(dayIndexInZone(INSTANT, START, undefined)).toBeNull();
    expect(dayIndexInZone(INSTANT, START, '')).toBeNull();
    expect(dayIndexInZone(INSTANT, START, 'Nope/Nowhere')).toBeNull();
  });

  it('returns null on a missing or malformed start day, or a bad instant', () => {
    expect(dayIndexInZone(INSTANT, null, PARIS)).toBeNull();
    expect(dayIndexInZone(INSTANT, '21/05/2026', PARIS)).toBeNull();
    expect(dayIndexInZone('not-a-date', START, PARIS)).toBeNull();
  });
});
