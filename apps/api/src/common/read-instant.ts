/**
 * The instant a stored or sent time string names, in epoch milliseconds, or null when it names
 * none. The one reading of a Match's start that the placement door refuses on and that a draft's
 * names show (call U), so the two never disagree on which times are readable.
 *
 * It reads as `Date.parse` does. A string with no offset ("2026-12-05T14:30") is read in this
 * process's zone by JavaScript, while Postgres reads the same string in the database's zone when
 * it is written to a `timestamptz`. That split exists today and is not decided here.
 */
export function readInstant(value: unknown): number | null {
  const parsed = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}
