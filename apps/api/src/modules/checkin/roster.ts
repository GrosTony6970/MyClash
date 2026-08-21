/**
 * Pure shaping for the check-in desk — no Supabase, no Nest.
 *
 * Split out so the decision that actually carries product meaning — what a desk
 * row shows — is unit-testable without a query-builder double.
 *
 * Ordering used to live here too (`orderMissingByUrgency`, for the separate
 * missing-at-risk screen). That screen is now a tab on the desk, and the
 * browser holds the whole roster, so the client sorts. Keeping a second copy
 * here would be two owners of one order.
 */

/** A `persons` row as the desk's select returns it. */
export interface RosterPersonRow {
  id: string;
  given_name: string;
  family_name: string;
  club_id: string | null;
  global_person_id: string | null;
  clubs: { name: string | null; logo_url: string | null } | null;
  global_persons: { photo_url: string | null } | null;
}

/** An `event_arrivals` row, or the absence of one. */
export interface ArrivalRow {
  person_id: string;
  state: string;
  via: string | null;
  marked_at: string | null;
  reversed_at: string | null;
}

export interface RosterEntry {
  personId: string;
  givenName: string;
  familyName: string;
  clubName: string | null;
  clubLogoUrl: string | null;
  photoUrl: string | null;
  arrived: boolean;
  /** When they were marked present. Null while absent. */
  arrivedAt: string | null;
  via: string | null;
  /**
   * The soonest bout this person is scheduled for, or null.
   *
   * On the row rather than on a second endpoint because the desk's Not-arrived
   * tab orders by it: the organiser chasing someone walks to a Lice, and a time
   * with no place to go does not tell them where.
   *
   * Always null on the gear table — that surface shows no schedule, and a gear
   * account has no reason to receive every fighter's next bout.
   */
  next: NextMatch | null;
}

export interface NextMatch {
  scheduledAt: string | null;
  liceName: string | null;
  poolName: string | null;
  tournamentName: string | null;
}

/**
 * What a desk screen gets back: the list, plus whether the ceiling cut it.
 *
 * An envelope rather than a bare array because both desks now count what they
 * were sent — a tab reads "Not arrived (63)" — and a silently truncated array
 * would make every one of those numbers a claim the screen cannot honour.
 * Shared by check-in and gear so the two screens read the same shape.
 */
export interface DeskList<T> {
  entries: T[];
  truncated: boolean;
}

/**
 * One desk row.
 *
 * `arrived` is derived from `state`, not from the row's existence: an undone
 * arrival keeps its row so the reversal has somewhere to record an actor, and
 * treating "has a row" as "is here" would make every undo invisible.
 *
 * The photo comes from `global_persons` because local `persons` has no
 * `photo_url` column — a fighter who has never been linked to a global identity
 * simply has no photo, which the desk renders as a placeholder rather than as
 * an error.
 */
export function mapRosterRow(
  person: RosterPersonRow,
  arrival: ArrivalRow | null,
  next: NextMatch | null = null,
): RosterEntry {
  const arrived = arrival?.state === 'present';
  return {
    next,
    personId: person.id,
    givenName: person.given_name,
    familyName: person.family_name,
    clubName: person.clubs?.name ?? null,
    clubLogoUrl: person.clubs?.logo_url ?? null,
    photoUrl: person.global_persons?.photo_url ?? null,
    arrived,
    // Only meaningful while present. Carrying the old timestamp through an undo
    // would render "arrived 09:12" beside an Absent state.
    arrivedAt: arrived ? (arrival?.marked_at ?? null) : null,
    via: arrived ? (arrival?.via ?? null) : null,
  };
}
