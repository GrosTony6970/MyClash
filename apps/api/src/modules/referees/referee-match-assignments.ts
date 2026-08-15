/**
 * The two inputs a per-match referee conflict check needs, in one id-space.
 *
 * `detectFighterRefereeConflicts` (@myclash/rulesets) answers "is this referee
 * also fighting somewhere that overlaps?" from three things: the bouts, the
 * referees committed to them, and which person each registration belongs to.
 * The schedule board already holds the bouts. This module owns the other two, so
 * the board can recompute the answer on every card move instead of asking the
 * server again.
 *
 * Pure: no Supabase, no Nest, no HTTP. The service hands it rows and gets the
 * wire payload back, which is what makes the id-space rule below assertable.
 *
 * ── ONE ID-SPACE, AND NO EMPTY KEYS ──────────────────────────────────────────
 *
 * `referee_assignments.person_id` points at `global_persons`. A registration
 * reaches the same space through `persons.global_person_id` — NOT `persons.id`,
 * which is the per-event identity and belongs to a different space entirely.
 * Projecting the wrong one produces a map that matches nothing, so the board
 * simply never warns and looks healthy. That is the shape of the Denis-Allaume
 * bug, and `conflict-check.controller.ts` carries a note pointing at it.
 *
 * The other half of the rule matters just as much: a row whose person cannot be
 * resolved is DROPPED, never emitted under an empty id. Defaulting to `''` looks
 * harmless and is not — the detector keys its lookup by person, so every
 * unlinked registration and every unlinked assignment would collapse onto the
 * same `''` key and match each other. That turns "two people we could not
 * identify" into "this referee is fighting right now", which is a false alarm on
 * the one banner an organiser has to be able to trust.
 */

/** One referee committed to one bout. */
export interface RefereeMatchAssignment {
  matchId: string;
  /** `global_persons.id`. */
  personId: string;
  personName: string;
  role: string;
}

/** Which global person a tournament registration belongs to. */
export interface RegistrationPerson {
  registrationId: string;
  /** `global_persons.id`, reached via `persons.global_person_id`. */
  personId: string;
  personName: string;
}

export interface RefereeMatchAssignmentsPayload {
  assignments: RefereeMatchAssignment[];
  registrations: RegistrationPerson[];
}

/** Name columns shared by both embeds. */
interface PersonNameColumns {
  given_name?: string | null;
  family_name?: string | null;
  display_name?: string | null;
}

export interface RawRefereeAssignmentRow {
  match_id: string | null;
  role: string | null;
  global_persons?: unknown;
}

export interface RawRegistrationRow {
  id: string;
  persons?: unknown;
}

/**
 * PostgREST nests a to-one embed as an object, or as a one-element array when
 * the relationship is resolved through a unique constraint. Both shapes reach
 * this code, so both are normalised — the same helper `matches.service.ts` grew
 * for the same reason.
 */
function one(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return (value[0] as Record<string, unknown>) ?? null;
  return (value as Record<string, unknown>) ?? null;
}

/**
 * Best available human name, or '' when the row carries none.
 *
 * An empty NAME is fine — the caller can fall back to the other side of the
 * conflict. An empty ID is not, which is why the two are handled separately.
 */
function personName(person: PersonNameColumns): string {
  const display = person.display_name?.trim();
  if (display) return display;
  return `${person.given_name ?? ''} ${person.family_name ?? ''}`.trim();
}

export function toRefereeMatchAssignments(
  rows: readonly RawRefereeAssignmentRow[],
): RefereeMatchAssignment[] {
  const assignments: RefereeMatchAssignment[] = [];
  for (const row of rows) {
    // A role-less assignment is not a commitment the board can name, and the
    // referee board skips those too.
    if (!row.match_id || !row.role) continue;
    const person = one(row.global_persons) as (PersonNameColumns & { id?: string }) | null;
    const personId = person?.id;
    if (!personId) continue;
    assignments.push({
      matchId: row.match_id,
      personId,
      personName: personName(person),
      role: row.role,
    });
  }
  return assignments;
}

export function toRegistrationPersons(rows: readonly RawRegistrationRow[]): RegistrationPerson[] {
  const registrations: RegistrationPerson[] = [];
  for (const row of rows) {
    const person = one(row.persons) as
      (PersonNameColumns & { global_person_id?: string | null }) | null;
    // `global_person_id`, never `persons.id` — see the id-space note above.
    const personId = person?.global_person_id;
    if (!personId) continue;
    registrations.push({
      registrationId: row.id,
      personId,
      personName: personName(person),
    });
  }
  return registrations;
}
