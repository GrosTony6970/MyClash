/**
 * Pure, clock-driven helpers for deciding which workshops are "live now" vs
 * "starting soon" on the event home. Workshops have no realtime state — they
 * move purely by the wall clock — so a workshop is live when a session window
 * contains the current instant, and upcoming when its soonest session is still
 * in the future. All comparisons are on absolute ms (Date.parse of the ISO
 * timestamptz), so they are DST-safe; the event timezone only affects display
 * (handled by WorkshopCard), never these booleans.
 */
import type { PublicWorkshop } from './public-event-data';

type Session = PublicWorkshop['sessions'][number];

/** A session is live when `startsAt <= now < endsAt`. Null/invalid bounds → not live. */
export function isSessionLive(session: Session, nowMs: number): boolean {
  if (!session.startsAt || !session.endsAt) return false;
  const start = Date.parse(session.startsAt);
  const end = Date.parse(session.endsAt);
  if (Number.isNaN(start) || Number.isNaN(end)) return false;
  return start <= nowMs && nowMs < end;
}

/** Earliest session start strictly after `now` (ms); `null` when the workshop has none. */
export function nextSessionStart(workshop: PublicWorkshop, nowMs: number): number | null {
  let soonest: number | null = null;
  for (const s of workshop.sessions) {
    if (!s.startsAt) continue;
    const start = Date.parse(s.startsAt);
    if (Number.isNaN(start) || start <= nowMs) continue;
    if (soonest === null || start < soonest) soonest = start;
  }
  return soonest;
}

/** Workshops with at least one session in progress right now. */
export function liveWorkshops(workshops: PublicWorkshop[], nowMs: number): PublicWorkshop[] {
  return workshops.filter((w) => w.sessions.some((s) => isSessionLive(s, nowMs)));
}

/**
 * Workshops that are NOT live now but have a future session — "starting soon".
 * Sorted by soonest start and capped (the full WORKSHOPS section already lists
 * the whole catalogue, so this stays a short teaser).
 */
export function upcomingWorkshops(
  workshops: PublicWorkshop[],
  nowMs: number,
  limit = 3,
): PublicWorkshop[] {
  return workshops
    .filter((w) => !w.sessions.some((s) => isSessionLive(s, nowMs)))
    .map((w) => ({ w, start: nextSessionStart(w, nowMs) }))
    .filter((x): x is { w: PublicWorkshop; start: number } => x.start !== null)
    .sort((a, b) => a.start - b.start)
    .slice(0, limit)
    .map((x) => x.w);
}
