import type {
  ConflictRefereeAssignment,
  ConflictScheduledMatch,
  RegistrationPersonMap,
} from '@myclash/rulesets/scheduling';
import { plannedLengthOf } from '../schedule/planned-length';

/**
 * Rows to `detectFighterRefereeConflicts` inputs, for the hard-rule-8 check.
 *
 * Extracted from `conflict-check.controller.ts` so the rule below can be
 * asserted. It was inline, and wrong.
 *
 * ── NO EMPTY PERSON KEYS ─────────────────────────────────────────────────────
 *
 * The detector keys its fighting-matches lookup BY PERSON ID. The controller
 * defaulted an unresolvable person to `''` on BOTH sides:
 *
 *     personId: person?.id ?? ''                    // referee side
 *     personId: person?.global_person_id ?? ''      // registration side
 *
 * so every referee with a missing embed and every fighter with no global
 * identity collapsed onto the same `''` key and matched each other. The endpoint
 * reported "this referee is also fighting" between two people it could not even
 * name — a false alarm on the one check that is a hard constraint.
 *
 * A row without a resolvable person is therefore DROPPED. It carries no
 * information the detector can use: an id that matches nothing is indistinguishable
 * from an absent row, and an id that matches everything is worse than one.
 *
 * The second half of the id-space rule still applies — a registration reaches
 * `global_persons` through `persons.global_person_id`, never `persons.id`. See
 * the sibling note in
 * `modules/referees/referee-match-assignments.ts`.
 *
 * ── EACH BOUT AT ITS OWN LENGTH ──────────────────────────────────────────────
 *
 * Both sides of an overlap are measured with the Match's planned length, which
 * the controller resolves from the Event's sheet (`resolveMatchLengths`,
 * ADR-018). Every bout used to count as five minutes, so a referee whose own
 * twelve-minute final started seven minutes before the bout they referee was
 * reported as free.
 *
 * A Match with no length in the map THROWS (`plannedLengthOf`). Guessing one is
 * how the five got here, and a throw stops the check instead of reporting
 * someone free.
 *
 * Pure: no Supabase, no Nest.
 */

/** Planned minutes per Match id, as `resolveMatchLengths` returns them. */
export type MatchLengths = ReadonlyMap<string, number>;

interface PersonEmbed {
  id?: string | null;
  global_person_id?: string | null;
  given_name?: string | null;
  family_name?: string | null;
}

export interface RawConflictMatchRow {
  id: string;
  phase_id: string;
  planned_duration_override_minutes: number | null;
  match_number_label?: string | null;
  red_registration_id?: string | null;
  blue_registration_id?: string | null;
  scheduled_at?: string | null;
}

export interface RawConflictAssignmentRow {
  match_id?: string | null;
  role?: string | null;
  global_persons?: unknown;
  matches?: unknown;
}

export interface RawConflictRegistrationRow {
  id: string;
  persons?: unknown;
}

/** PostgREST nests a to-one embed as an object or a one-element array. */
function one(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return (value[0] as Record<string, unknown>) ?? null;
  return (value as Record<string, unknown>) ?? null;
}

function fullName(person: PersonEmbed | null): string {
  if (!person) return '';
  return `${person.given_name ?? ''} ${person.family_name ?? ''}`.trim();
}

export function toConflictMatches(
  rows: readonly RawConflictMatchRow[],
  lengths: MatchLengths,
): ConflictScheduledMatch[] {
  return rows.map((row) => ({
    id: row.id,
    label: row.match_number_label ?? row.id,
    redRegistrationId: row.red_registration_id ?? '',
    blueRegistrationId: row.blue_registration_id ?? '',
    scheduledAt: row.scheduled_at ?? null,
    durationMinutes: plannedLengthOf(lengths, row.id),
  }));
}

export function toConflictAssignments(
  rows: readonly RawConflictAssignmentRow[],
  lengths: MatchLengths,
): ConflictRefereeAssignment[] {
  const assignments: ConflictRefereeAssignment[] = [];
  for (const row of rows) {
    const matchId = row.match_id;
    if (!matchId || !row.role) continue;
    const person = one(row.global_persons) as PersonEmbed | null;
    // Dropped, never keyed under ''. See the note above.
    if (!person?.id) continue;
    const match = one(row.matches) as {
      match_number_label?: string | null;
      scheduled_at?: string | null;
    } | null;
    assignments.push({
      matchId,
      matchLabel: match?.match_number_label ?? matchId,
      personId: person.id,
      personName: fullName(person),
      role: row.role,
      scheduledAt: match?.scheduled_at ?? null,
      durationMinutes: plannedLengthOf(lengths, matchId),
    });
  }
  return assignments;
}

export function toRegistrationPersonMap(
  rows: readonly RawConflictRegistrationRow[],
): RegistrationPersonMap[] {
  const map: RegistrationPersonMap[] = [];
  for (const row of rows) {
    const person = one(row.persons) as PersonEmbed | null;
    // `global_person_id`, never `persons.id` — different id spaces.
    const personId = person?.global_person_id;
    if (!personId) continue;
    map.push({ registrationId: row.id, personId, personName: fullName(person) });
  }
  return map;
}
