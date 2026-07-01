/**
 * Shared types, fetchers and helpers for the public event pages (home, the two
 * schedule pages, the tournaments list). Extracted from PublicHome so the home,
 * the per-kind schedule pages and the tournaments full-list page all use one
 * implementation rather than duplicated markup/fetch logic. Server-only (uses
 * `fetch` with `cache: 'no-store'`).
 */

export interface Tournament {
  id: string;
  slug: string;
  name: string;
  status: string | null;
  color: string | null;
  ruleset_code: string | null;
  registered: number;
  waitlistCount: number;
  poolCount: number;
  bracketSize: number;
  refereeCount: number;
  poolFightsTotal: number;
  poolFightsCompleted: number;
  bracketFightsTotal: number;
  bracketFightsCompleted: number;
  /** Earliest / latest scheduled match (ISO) — earliest = the first pool. */
  scheduledStart: string | null;
  scheduledEnd: string | null;
}

export interface PublicWorkshop {
  id: string;
  slug: string;
  title: string;
  category: string | null;
  level: string | null;
  color: string | null;
  coverImageUrl: string | null;
  durationMinutes: number | null;
  instructors: Array<{ displayName: string }>;
  sessions: Array<{ startsAt: string | null; endsAt: string | null }>;
}

export interface PublicVenue {
  id: string;
  name: string;
  address: string | null;
  hosts_tournament: boolean;
  hosts_workshop: boolean;
  venue_areas: Array<{ id: string; name: string }> | null;
}

export interface HighlightMatch {
  id: string;
  matchNumberLabel: string;
  status: string;
  scheduledAt: string | null;
  redFighterName: string | null;
  blueFighterName: string | null;
  redScore: number;
  blueScore: number;
  liceName: string | null;
  tournamentName: string | null;
}

interface ParticipantRow {
  personId: string;
  tournaments: Array<{ registrationState: 'active' | 'waitlist' }>;
}

export async function fetchTournaments(eventId: string, apiUrl: string): Promise<Tournament[]> {
  if (!eventId) return [];
  try {
    const res = await fetch(`${apiUrl}/api/v1/events/${eventId}/tournaments`, {
      cache: 'no-store',
    });
    if (!res.ok) return [];
    return (await res.json()) as Tournament[];
  } catch {
    return [];
  }
}

export async function fetchWorkshops(eventSlug: string, apiUrl: string): Promise<PublicWorkshop[]> {
  try {
    const res = await fetch(
      `${apiUrl}/api/v1/events/${encodeURIComponent(eventSlug)}/public-workshops`,
      { cache: 'no-store' },
    );
    if (!res.ok) return [];
    return (await res.json()) as PublicWorkshop[];
  } catch {
    return [];
  }
}

export async function fetchVenues(eventSlug: string, apiUrl: string): Promise<PublicVenue[]> {
  try {
    const res = await fetch(
      `${apiUrl}/api/v1/events/slug/${encodeURIComponent(eventSlug)}/venues`,
      {
        cache: 'no-store',
      },
    );
    if (!res.ok) return [];
    return (await res.json()) as PublicVenue[];
  } catch {
    return [];
  }
}

export async function fetchParticipantsCounts(
  eventSlug: string,
  apiUrl: string,
): Promise<{ active: number; waitlist: number }> {
  try {
    const res = await fetch(
      `${apiUrl}/api/v1/events/${encodeURIComponent(eventSlug)}/participants`,
      { cache: 'no-store' },
    );
    if (!res.ok) return { active: 0, waitlist: 0 };
    const rows = (await res.json()) as ParticipantRow[];
    // Distinct people: `active` if they have at least one active registration,
    // else `waitlist`. Avoids double-counting multi-tournament registrants.
    let active = 0;
    let waitlist = 0;
    for (const row of rows) {
      if (row.tournaments.some((t) => t.registrationState === 'active')) active += 1;
      else waitlist += 1;
    }
    return { active, waitlist };
  } catch {
    return { active: 0, waitlist: 0 };
  }
}

export async function fetchHighlights(
  eventSlug: string,
  apiUrl: string,
): Promise<HighlightMatch[]> {
  try {
    const res = await fetch(`${apiUrl}/api/v1/events/${eventSlug}/highlights`, {
      cache: 'no-store',
    });
    if (!res.ok) return [];
    return (await res.json()) as HighlightMatch[];
  } catch {
    return [];
  }
}
