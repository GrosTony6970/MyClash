/**
 * Pure shaping for the check-in desk — no Supabase, no Nest.
 *
 * Split out so the two decisions that actually carry product meaning (what a
 * desk row shows, and what "at risk" orders by) are unit-testable without a
 * query-builder double.
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
}

export interface NextMatch {
  scheduledAt: string | null;
  liceName: string | null;
  poolName: string | null;
  tournamentName: string | null;
}

export interface MissingFighter {
  person: RosterEntry;
  next: NextMatch | null;
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
export function mapRosterRow(person: RosterPersonRow, arrival: ArrivalRow | null): RosterEntry {
  const arrived = arrival?.state === 'present';
  return {
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

/**
 * Missing fighters, most urgent first.
 *
 * Ordered by when they next fight, because urgency is the entire question this
 * screen answers — alphabetical would bury the person due on piste 3 in twelve
 * minutes behind eleven people who fight this afternoon.
 *
 * Fighters with no scheduled bout sort LAST rather than being filtered out.
 * They are still missing; they are just not yet costing anyone time, and
 * dropping them would quietly shrink the "who isn't here" count that the desk
 * is trusted to be complete.
 */
export function orderMissingByUrgency(entries: MissingFighter[]): MissingFighter[] {
  return [...entries].sort((a, b) => {
    const aAt = a.next?.scheduledAt ?? null;
    const bAt = b.next?.scheduledAt ?? null;
    if (aAt && bAt) return aAt.localeCompare(bAt) || compareByName(a, b);
    if (aAt) return -1;
    if (bAt) return 1;
    // Both unscheduled: a stable, human order so the tail of the list does not
    // reshuffle on every poll.
    return compareByName(a, b);
  });
}

function compareByName(a: MissingFighter, b: MissingFighter): number {
  return (
    a.person.familyName.localeCompare(b.person.familyName) ||
    a.person.givenName.localeCompare(b.person.givenName)
  );
}
