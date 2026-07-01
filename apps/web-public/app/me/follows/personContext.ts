/**
 * Shared types + fetch helper for the People-hub live context
 * (`GET /api/v1/me/people/context` and `GET /api/v1/me/following`).
 */

export interface PersonContextNextMatch {
  label: string;
  scheduledAt: string | null;
  opponentName: string | null;
  poolName: string | null;
  liceName: string | null;
}

export interface PersonContext {
  globalPersonId: string;
  slug: string;
  displayName: string;
  clubName: string | null;
  photoUrl: string | null;
  countryCode: string | null;
  /** HEMA Ratings id, shown as the fighter's license. */
  license: string | null;
  isFollowing: boolean;
  tournament: { id: string; name: string; slug: string } | null;
  poolName: string | null;
  rank: number | null;
  nextMatch: PersonContextNextMatch | null;
}

/** A persistent follow, enriched, with the event-follow backing its toggles. */
export interface PersonFollowing extends PersonContext {
  followedAt: string;
  eventFollow: {
    eventId: string;
    personId: string;
    notifyMatchStart: boolean;
    notifyWorkshopStart: boolean;
    active: boolean;
  } | null;
}

/** Fetch live context for a set of global-person ids, keyed by id. Best-effort:
 *  returns an empty map on error so search/following never hard-fail on it. */
export async function fetchPeopleContext(
  apiUrl: string,
  ids: string[],
  signal?: AbortSignal,
): Promise<Map<string, PersonContext>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return new Map();
  try {
    const res = await fetch(
      `${apiUrl}/api/v1/me/people/context?globalPersonIds=${unique.map(encodeURIComponent).join(',')}`,
      { credentials: 'include', signal },
    );
    if (!res.ok) return new Map();
    const rows = (await res.json()) as PersonContext[];
    return new Map(rows.map((r) => [r.globalPersonId, r]));
  } catch {
    return new Map();
  }
}
