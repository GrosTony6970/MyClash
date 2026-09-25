/**
 * The inputs the schedule board's live referee check needs, in one id-space.
 *
 * The one checker (`@myclash/rulesets/scheduling/referee-checker`, ADR-016) answers
 * "may this person referee this?" from commitments. The schedule board already
 * holds the bouts, so it builds the fights and the Pool spans itself; this module
 * owns the rest it cannot see — every referee duty, Pool-scoped AND Match-scoped
 * (a Pool crew is one Pool-scoped row, and a check that read bout rows only never
 * saw it), what each duty's organiser already confirmed over, and which person
 * each registration belongs to. The board recomputes on every card move instead
 * of asking the server again.
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
import {
  parseStoredReasons,
  type RefereeSwitches,
  type StoredRefereeReason,
} from '@myclash/rulesets/scheduling/referee-checker';

/** One referee duty: a whole Pool (`scopeType: 'pool'`) or one bout (`'match'`). */
export interface RefereeMatchAssignment {
  scopeType: 'pool' | 'match';
  /** The bout, for a Match-scoped duty; null for a Pool-scoped one. */
  matchId: string | null;
  /** The Pool, for a Pool-scoped duty; null for a Match-scoped one. */
  poolId: string | null;
  /** `global_persons.id`. */
  personId: string;
  personName: string;
  role: string;
  /** The Discouraged reasons the organiser confirmed over when assigning (ruling 135). */
  confirmedReasons: StoredRefereeReason[];
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
  /** The Event's Discouraged switches, so the board grades amber as the server does. */
  rules: RefereeSwitches;
}

/** Name columns shared by both embeds. */
interface PersonNameColumns {
  given_name?: string | null;
  family_name?: string | null;
  display_name?: string | null;
}

export interface RawRefereeAssignmentRow {
  scope_type: string;
  match_id: string | null;
  pool_id: string | null;
  role: string | null;
  conflicts_jsonb?: unknown;
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
    // referee board skips those too. A row must carry its own scope's target.
    const scopeType =
      row.scope_type === 'match' && row.match_id
        ? 'match'
        : row.scope_type === 'pool' && row.pool_id
          ? 'pool'
          : null;
    if (!scopeType || !row.role) continue;
    const person = one(row.global_persons) as (PersonNameColumns & { id?: string }) | null;
    const personId = person?.id;
    if (!personId) continue;
    assignments.push({
      scopeType,
      matchId: scopeType === 'match' ? row.match_id : null,
      poolId: scopeType === 'pool' ? row.pool_id : null,
      personId,
      personName: personName(person),
      role: row.role,
      confirmedReasons: parseStoredReasons(row.conflicts_jsonb),
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
