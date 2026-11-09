import { isPublicEvent } from '../../common/auth/event-read-gate';

/**
 * The Workshop statuses the public sees (migration 0100; mirrors `PUBLIC_TOURNAMENT_STATUSES`):
 * a draft Workshop is the organiser's alone. A leaf, so a worker can read it without importing
 * the Workshops service (which imports the follow alerts' scheduler).
 */
export const PUBLIC_WORKSHOP_STATUSES = ['published', 'running', 'completed'];

/** The embed `isWorkshopNews` reads: `workshops(status, events(status, event_kind))`. */
export const WORKSHOP_NEWS_EMBED = 'workshops(status, events(status, event_kind))';

type One<T> = T | T[] | null | undefined;
const one = <T>(value: One<T>): T | null =>
  (Array.isArray(value) ? (value[0] ?? null) : (value ?? null)) as T | null;

/**
 * Is a change to this Workshop's session news to the people booked: a published, running or
 * completed Workshop of a public Event that is not a TEST Event (operator rulings, 2026-11-09)?
 * A draft's planning tells nobody, nor does a rehearsal, as the results notice (rulings 196,
 * 197). The "starting soon" alerts ring in a test Event (ruling 185); a moved or cancelled
 * session does not. `workshop` is the `workshops(...)` embed of a session row; a row read
 * without its statuses counts as no news.
 */
export function isWorkshopNews(
  workshop: One<{ status?: unknown; events?: One<{ status?: unknown; event_kind?: unknown }> }>,
): boolean {
  const row = one(workshop);
  const event = one(row?.events);
  return (
    PUBLIC_WORKSHOP_STATUSES.includes(String(row?.status)) &&
    Boolean(event?.status) &&
    isPublicEvent(event)
  );
}
