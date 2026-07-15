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
