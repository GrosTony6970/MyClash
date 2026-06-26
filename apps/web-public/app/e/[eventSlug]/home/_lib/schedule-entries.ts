/**
 * Builds the day-grouped schedule agenda from tournaments / workshops. Used by
 * the two public schedule pages (tournament schedule, workshop schedule). The
 * home page links to those pages via summary cards; the full agenda lives here.
 */

import { zonedDay } from '@myclash/time';
import type { PublicWorkshop, Tournament } from './public-event-data';

export interface ScheduleEntry {
  id: string;
  startsAt: string;
  endsAt: string | null;
  title: string;
  subtitle: string | null;
  color: string | null;
  href: string;
}

export interface ScheduleDay {
  dayKey: string;
  /** A representative ISO instant in the day, for formatting the day label. */
  repStart: string;
  entries: ScheduleEntry[];
}

/** Scheduled tournaments → entries (window from the match scheduled_at span). */
export function buildTournamentEntries(
  tournaments: Tournament[],
  eventSlug: string,
): ScheduleEntry[] {
  return tournaments
    .filter((tournament) => tournament.scheduledStart)
    .map((tournament) => ({
      id: `t-${tournament.id}`,
      startsAt: tournament.scheduledStart as string,
      endsAt: tournament.scheduledEnd,
      title: tournament.name,
      subtitle: tournament.ruleset_code,
      color: tournament.color,
      href: `/e/${eventSlug}/t/${encodeURIComponent(tournament.slug)}`,
    }));
}

/** Workshops with a session → entries (using the earliest session). */
export function buildWorkshopEntries(
  workshops: PublicWorkshop[],
  eventSlug: string,
): ScheduleEntry[] {
  return workshops
    .map((w) => {
      const session = w.sessions
        .filter((s) => s.startsAt)
        .sort((a, b) => ((a.startsAt as string) < (b.startsAt as string) ? -1 : 1))[0];
      return session ? { w, session } : null;
    })
    .filter((x): x is { w: PublicWorkshop; session: PublicWorkshop['sessions'][number] } =>
      Boolean(x),
    )
    .map(({ w, session }) => ({
      id: `w-${w.id}`,
      startsAt: session.startsAt as string,
      endsAt: session.endsAt,
      title: w.title,
      subtitle: w.instructors.map((i) => i.displayName).join(', ') || null,
      color: w.color,
      href: `/e/${eventSlug}/w/${encodeURIComponent(w.slug)}`,
    }));
}

/** Sort entries chronologically and group them by day (event timezone). */
export function groupByDay(entries: ScheduleEntry[], tz: string): ScheduleDay[] {
  const sorted = [...entries].sort((a, b) => (a.startsAt < b.startsAt ? -1 : 1));
  const byDay = new Map<string, ScheduleEntry[]>();
  for (const entry of sorted) {
    const key = zonedDay(entry.startsAt, tz) ?? entry.startsAt.slice(0, 10);
    const arr = byDay.get(key) ?? [];
    arr.push(entry);
    byDay.set(key, arr);
  }
  return [...byDay.keys()].sort().map((dayKey) => ({
    dayKey,
    repStart: (byDay.get(dayKey) ?? [])[0]?.startsAt ?? dayKey,
    entries: byDay.get(dayKey) ?? [],
  }));
}
