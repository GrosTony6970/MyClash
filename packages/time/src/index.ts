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
  return dt.setLocale(locale).toLocaleString(options);
}
