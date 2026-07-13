/**
 * Shared types + fetch helper for the People-hub live context
 * (`GET /api/v1/me/people/context` and `GET /api/v1/me/following`).
 */

/** A live or upcoming commitment on a card — a bout the fighter is fighting, or
 *  (kind === 'referee') a match they're officiating. */
export interface PersonContextMatch {
  kind: 'fight' | 'referee';
  matchId: string;
  label: string;
  /** Server match status ('scheduled' | 'running' | 'paused' | …). */
  status: string;
  scheduledAt: string | null;
  opponentName: string | null;
  poolName: string | null;
  liceName: string | null;
  /** Public event slug, for a deep link to the match page. */
  eventSlug: string | null;
  /** Referee-only: officiating skill name + colour, and the event name. */
  skillName: string | null;
  skillColor: string | null;
  eventName: string | null;
}

/** A fighter's tournament placement once the tournament is decided. */
export interface PersonContextFinalRank {
  place: number;
  resultKind: string;
  totalRanked: number;
}

/** The most recent completed result for an idle followee (no active event). */
export interface PersonContextLastResult {
  eventName: string;
  eventSlug: string;
  tournamentName: string;
  tournamentSlug: string;
  weapon: string | null;
  finalRank: PersonContextFinalRank | null;
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
  /** Parent event of the focus tournament (shown above the tournament name). */
  event: { id: string; name: string; slug: string } | null;
  tournament: { id: string; name: string; slug: string; weapon: string | null } | null;
  poolName: string | null;
  /** Live pool-standing rank in the focus tournament. */
  rank: number | null;
  /** Full-tournament placement — null until the bracket Final is decided. */
  finalRank: PersonContextFinalRank | null;
  /** For idle followees (no active event): their most recent completed result. */
  lastResult: PersonContextLastResult | null;
  /** In-progress bout, or the live match they're refereeing (fight takes priority). */
  currentMatch: PersonContextMatch | null;
  nextMatch: PersonContextMatch | null;
}

/** A persistent follow, enriched, with the event-follow backing its toggles. */
export interface PersonFollowing extends PersonContext {
  followedAt: string;
  eventFollow: {
    eventId: string;
    personId: string;
    notifyMatchStart: boolean;
    notifyWorkshopStart: boolean;
    notifyRefereeStart: boolean;
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
