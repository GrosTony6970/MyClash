/**
 * @myclash/time — event-timezone helpers.
 *
 * Times are stored in the DB as UTC instants (TIMESTAMPTZ). Wall-clock
 * input/display must be interpreted in the EVENT's IANA timezone, not the
 * browser's — otherwise an organizer in a different timezone schedules and
 * reads the wrong hour. These pure Luxon wrappers are the single place that
 * conversion happens, shared by the api and both front-ends.
 *
 * All functions are total: invalid input yields null / a safe fallback
 * rather than throwing, so callers can use them on every keystroke/render.
 */

import { DateTime } from 'luxon';

export const DEFAULT_EVENT_TIMEZONE = 'Europe/Paris';

const HHMM = /^(\d{1,2}):(\d{2})$/;
const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Combine a wall-clock day (`YYYY-MM-DD`) + time (`HH:MM`) interpreted in
 * `tz` into the corresponding UTC ISO instant. Returns null on bad input.
 */
export function zonedToUtcIso(
  day: string | null | undefined,
  hhmm: string | null | undefined,
  tz: string,
): string | null {
  if (!day || !hhmm || !YMD.test(day) || !HHMM.test(hhmm)) return null;
  const [h, m] = hhmm.split(':').map(Number);
  const dt = DateTime.fromObject(
    {
      year: Number(day.slice(0, 4)),
      month: Number(day.slice(5, 7)),
      day: Number(day.slice(8, 10)),
      hour: h,
      minute: m,
    },
    { zone: tz },
  );
  if (!dt.isValid) return null;
  return dt.toUTC().toISO();
}

/** Split a UTC ISO instant into its wall-clock `{ day, hhmm }` in `tz`. */
export function utcToZonedParts(
  iso: string | null | undefined,
  tz: string,
): { day: string; hhmm: string } | null {
  if (!iso) return null;
  const dt = DateTime.fromISO(iso, { zone: 'utc' }).setZone(tz);
  if (!dt.isValid) return null;
  return { day: dt.toFormat('yyyy-MM-dd'), hhmm: dt.toFormat('HH:mm') };
}

/** Minutes since local midnight (in `tz`) for a UTC ISO instant — for grid slot math. */
export function minutesIntoDayInZone(iso: string | null | undefined, tz: string): number | null {
  if (!iso) return null;
  const dt = DateTime.fromISO(iso, { zone: 'utc' }).setZone(tz);
  if (!dt.isValid) return null;
  return dt.hour * 60 + dt.minute;
}

/** The UTC ISO instant of `hour:00` on `day` in `tz` (grid axis origin). */
export function dayStartUtcIso(day: string, tz: string, hour = 0): string | null {
  return zonedToUtcIso(day, `${String(hour).padStart(2, '0')}:00`, tz);
}

/** The local calendar date (`YYYY-MM-DD`, in `tz`) of a UTC ISO instant. */
export function zonedDay(iso: string | null | undefined, tz: string): string | null {
  return utcToZonedParts(iso, tz)?.day ?? null;
}

/**
 * Which day of an event a UTC instant falls on: a 0-based index counted from
 * the event's start date, with the day boundary read in the EVENT's timezone.
 *
 * The two dates are subtracted as plain calendar days, not as a span of hours.
 * A day is not always 24 hours — on a DST change it is 23 or 25 — so dividing
 * an elapsed-milliseconds difference by 86_400_000 misplaces an instant near
 * midnight exactly twice a year. Both sides here are already whole days, so the
 * quotient is exact.
 *
 * A date before `startDay` clamps to 0 rather than going negative, matching the
 * callers that treat day 0 as "the first day of the event".
 *
 * `tz` is required and is never defaulted here. Luxon's `setZone(undefined)`
 * resolves to the SYSTEM zone rather than reporting itself invalid, so a helper
 * that shrugged at a missing zone would quietly answer with the server's clock —
 * which is the exact bug this function exists to remove. Absent or unparseable
 * input yields null, and the caller states its own fallback.
 */
export function dayIndexInZone(
  iso: string | null | undefined,
  startDay: string | null | undefined,
  tz: string | null | undefined,
): number | null {
  if (!tz || !startDay || !YMD.test(startDay)) return null;
  // An unusable zone string ('Nope/Nowhere') already fails inside zonedDay,
  // which null-checks Luxon's `isValid`; only the absent case needs the guard
  // above.
  const day = zonedDay(iso, tz);
  if (!day) return null;
  const elapsed = Date.parse(`${day}T00:00:00.000Z`) - Date.parse(`${startDay}T00:00:00.000Z`);
  if (Number.isNaN(elapsed)) return null;
  return Math.max(0, Math.round(elapsed / 86_400_000));
}

/**
 * Locale-aware display of a UTC instant in the event timezone. Falls back to
 * an empty string on bad input so it's safe to drop straight into JSX.
 */
export function formatInZone(
  iso: string | null | undefined,
  tz: string,
  options: Intl.DateTimeFormatOptions,
  locale = 'fr-FR',
): string {
  if (!iso) return '';
  const dt = DateTime.fromISO(iso, { zone: 'utc' }).setZone(tz);
  if (!dt.isValid) return '';
  // Force 24-hour clock for any time-bearing format unless the caller opted
  // into a specific cycle — so the display never shows AM/PM regardless of locale.
  const opts: Intl.DateTimeFormatOptions =
    options.hour !== undefined && options.hour12 === undefined && options.hourCycle === undefined
      ? { ...options, hour12: false }
      : options;
  return dt.setLocale(locale).toLocaleString(opts);
}

// --- Locale-aware display helpers ---------------------------------------
// The UI locale is the two-letter app locale ('en' | 'fr'); date formatting
// needs a BCP-47 tag. Inlined here (not imported from @myclash/i18n) to keep
// this package dependency-light — it is shared by the api too.

/** The two-letter UI locale. Mirror of `Locale` in @myclash/i18n. */
export type AppLocale = 'en' | 'fr';

/**
 * Map a UI locale to the BCP-47 tag used for date/number formatting. English
 * uses `en-GB` (DD/MM, 24h) rather than `en-US` — MyClash is a European HEMA
 * platform, so day-first + 24-hour reads correctly for both audiences.
 */
export function localeToBcp47(locale: AppLocale): string {
  return locale === 'fr' ? 'fr-FR' : 'en-GB';
}

const DATE_OPTS: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' };
const TIME_OPTS: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', hour12: false };

/**
 * Format a UTC instant for display in the UI locale. Pass an event `tz` to
 * anchor the wall-clock to the event timezone (schedule/event surfaces);
 * omit it for plain timestamps shown in the viewer's local zone (admin lists,
 * "created at"). Safe on bad input (returns '').
 */
export function formatDate(
  iso: string | null | undefined,
  locale: AppLocale,
  options: Intl.DateTimeFormatOptions = DATE_OPTS,
  tz?: string,
): string {
  return formatLocalized(iso, locale, options, tz);
}

/** Time-of-day in the UI locale (24-hour). See {@link formatDate} re: `tz`. */
export function formatTime(
  iso: string | null | undefined,
  locale: AppLocale,
  options: Intl.DateTimeFormatOptions = TIME_OPTS,
  tz?: string,
): string {
  return formatLocalized(iso, locale, options, tz);
}

/** Date + time in the UI locale. See {@link formatDate} re: `tz`. */
export function formatDateTime(
  iso: string | null | undefined,
  locale: AppLocale,
  options: Intl.DateTimeFormatOptions = { ...DATE_OPTS, ...TIME_OPTS },
  tz?: string,
): string {
  return formatLocalized(iso, locale, options, tz);
}

/**
 * A start–end range in the UI locale, collapsing shared parts
 * ("21–23 Jun 2027", "21 Jun – 3 Jul 2027"). Falls back to the single
 * available endpoint when the other is missing/invalid.
 */
export function formatDateRange(
  startIso: string | null | undefined,
  endIso: string | null | undefined,
  locale: AppLocale,
  options: Intl.DateTimeFormatOptions = DATE_OPTS,
  tz?: string,
): string {
  const start = formatLocalized(startIso, locale, options, tz);
  const end = formatLocalized(endIso, locale, options, tz);
  if (!start) return end;
  if (!end || start === end) return start;
  return `${start} – ${end}`;
}

// --- Calendar gaps -------------------------------------------------------
// A countdown expressed in days stops being readable somewhere around three
// digits — nobody converts "26505 days" into "about 72 years" while scanning a
// dashboard. These express a gap in calendar units instead, and leave the
// wording to Intl: unit names and plural forms come from the platform, so no
// translation key has to carry a "day(s)" fudge for a translator layer that
// has no plural support.

/** The two units of a gap that are worth reading. */
const GAP_UNITS = ['year', 'month', 'day'] as const;

/**
 * A gap between two calendar days, split into calendar units. `direction` is
 * the sign (1 = `toDay` is later, -1 = earlier, 0 = same day); the magnitudes
 * are always non-negative, so callers never juggle `Math.abs`.
 */
export interface CalendarGap {
  direction: 1 | 0 | -1;
  years: number;
  months: number;
  days: number;
}

/**
 * Split the distance between two wall-clock days (`YYYY-MM-DD`) into whole
 * years/months/days. Luxon does the arithmetic, so month lengths and leap days
 * are real rather than a `/30` approximation: 31 Jan → 28 Feb is 28 days, not
 * "0.93 months". Returns null on malformed input.
 */
export function calendarGapBetweenDays(
  fromDay: string | null | undefined,
  toDay: string | null | undefined,
): CalendarGap | null {
  if (!fromDay || !toDay || !YMD.test(fromDay) || !YMD.test(toDay)) return null;
  const from = DateTime.fromISO(fromDay, { zone: 'utc' });
  const to = DateTime.fromISO(toDay, { zone: 'utc' });
  if (!from.isValid || !to.isValid) return null;

  if (+from === +to) return { direction: 0, years: 0, months: 0, days: 0 };

  // Always diff larger-minus-smaller and carry the sign separately, so the
  // parts stay positive whichever way the gap points.
  const direction: 1 | -1 = to > from ? 1 : -1;
  const [early, late] = direction === 1 ? [from, to] : [to, from];
  const diff = late.diff(early, ['years', 'months', 'days']);
  return {
    direction,
    years: Math.floor(diff.years),
    months: Math.floor(diff.months),
    days: Math.floor(diff.days),
  };
}

/**
 * A gap as its two largest non-zero units ("72 years, 7 months",
 * "1 month, 16 days", "18 days", "1 day"). Truncated, not rounded — the same
 * convention as stating an age. Never returns an empty string: a zero gap
 * reads as "0 days".
 */
export function formatCalendarGap(gap: CalendarGap, locale: AppLocale): string {
  const bcp47 = localeToBcp47(locale);
  const counted = GAP_UNITS.map((unit, i) => ({
    unit,
    value: [gap.years, gap.months, gap.days][i] ?? 0,
  }));

  // Start at the largest unit that actually has a value, then keep the next one
  // down. A trailing zero is dropped, so "1 year, 0 months" reads as "1 year";
  // an all-zero gap falls back to days so the result is never empty.
  const lead = counted.findIndex((part) => part.value > 0);
  const kept =
    lead === -1
      ? [{ unit: 'day' as const, value: 0 }]
      : counted.slice(lead, lead + 2).filter((part, i) => i === 0 || part.value > 0);

  const parts = kept.map(({ unit, value }) =>
    new Intl.NumberFormat(bcp47, { style: 'unit', unit, unitDisplay: 'long' }).format(value),
  );
  // 'short' rather than 'narrow': narrow joins with a bare space ("72 years
  // 6 months"), short gives each locale its own connector — a comma in English,
  // "et" in French.
  return new Intl.ListFormat(bcp47, { style: 'short', type: 'unit' }).format(parts);
}

/**
 * A bare count of days with the locale's own plural form ("1 day", "3 days",
 * "1 jour"). For spans that are genuinely day-scaled, like an event's length.
 */
export function formatDayCount(count: number, locale: AppLocale): string {
  return new Intl.NumberFormat(localeToBcp47(locale), {
    style: 'unit',
    unit: 'day',
    unitDisplay: 'long',
  }).format(count);
}

/**
 * A span in whole minutes with the locale's own plural form ("1 min", "12 min",
 * "12 minutes"). For operational lateness — "started 6 min late", "over by
 * 3 min" — where the interesting resolution is minutes, not seconds.
 *
 * `short` rather than `long`: these sit inline in a dense board row, and a
 * sub-minute span rounds up to 1 rather than reading "0 min", because a piste
 * reported as late is late by something.
 */
export function formatMinuteSpan(ms: number, locale: AppLocale): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  return new Intl.NumberFormat(localeToBcp47(locale), {
    style: 'unit',
    unit: 'minute',
    unitDisplay: 'short',
  }).format(minutes);
}

function formatLocalized(
  iso: string | null | undefined,
  locale: AppLocale,
  options: Intl.DateTimeFormatOptions,
  tz?: string,
): string {
  if (!iso) return '';
  const base = DateTime.fromISO(iso, { zone: 'utc' });
  if (!base.isValid) return '';
  const dt = tz ? base.setZone(tz) : base.toLocal();
  const opts: Intl.DateTimeFormatOptions =
    options.hour !== undefined && options.hour12 === undefined && options.hourCycle === undefined
      ? { hour12: false, ...options }
      : options;
  return dt.setLocale(localeToBcp47(locale)).toLocaleString(opts);
}
