/**
 * Load a whole event's referee assignments once, name-resolved, in the shape
 * `resolveMatchReferees` consumes.
 *
 * Exists because the only loader we had (`resolveMatchRefereesForSummary`) was
 * per-match: it scanned every assignment in the event AND ran a second
 * `global_persons` lookup, for one match. Resolving a lice's whole day that way
 * would be two queries per bout. This is one query for the event; callers then
 * filter in memory, at zero further I/O, for as many matches as they like.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { RefereeAssignmentRow } from './resolve-match-referees';

/**
 * What counts as "this person is officiating". `pending` is included because an
 * unconfirmed referee is still the one standing on the piste — the same filter
 * the match-summary endpoint has always used.
 */
const ACTIVE_STATUSES = ['assigned', 'confirmed', 'pending'] as const;

interface PersonEmbed {
  given_name?: string | null;
  family_name?: string | null;
}

interface RawAssignmentRow {
  scope_type: string;
  match_id: string | null;
  pool_id: string | null;
  lice_id: string | null;
  person_id: string | null;
  /**
   * PostgREST returns a many-to-one embed as an object or as a single-element
   * array depending on how it resolves the relationship, and it has flipped
   * before. Tolerate both rather than betting on one.
   *
   * The FK is `person_id -> global_persons`; embedding `persons(...)` here
   * 400s (see phases.service.ts, which learned the same thing).
   */
  global_persons?: PersonEmbed | PersonEmbed[] | null;
}

/**
 * Pure — exported so the embed flip and the name composition can be tested
 * without a Supabase client.
 *
 * Composes `given + family` rather than preferring `display_name`. That is what
 * the match-summary endpoint has always sent, and this helper now backs it, so
 * reading `display_name` here would silently rename referees on a public
 * payload. `phases.service.ts` does prefer `display_name` and stays the
 * outlier; unifying them is a deliberate product decision, not a refactor.
 */
export function toAssignmentRow(raw: RawAssignmentRow): RefereeAssignmentRow {
  const embed = raw.global_persons;
  const person: PersonEmbed | null = Array.isArray(embed) ? (embed[0] ?? null) : (embed ?? null);
  const name = `${person?.given_name ?? ''} ${person?.family_name ?? ''}`.trim();
  return {
    scopeType: raw.scope_type,
    matchId: raw.match_id,
    poolId: raw.pool_id,
    liceId: raw.lice_id,
    name,
  };
}

/**
 * Every active referee assignment for an event, ready for
 * `resolveMatchReferees(index, target)`.
 *
 * Rows whose person could not be name-resolved are dropped: a blank name would
 * survive `resolveMatchReferees`' scope precedence and shadow a lower tier that
 * does have a name, so the operator would see an empty referee line instead of
 * the pool's referee.
 */
export async function fetchRefereeAssignmentIndex(
  supabase: SupabaseClient,
  eventId: string,
): Promise<RefereeAssignmentRow[]> {
  const { data, error } = await supabase
    .from('referee_assignments')
    .select(
      'scope_type, match_id, pool_id, lice_id, person_id, global_persons(given_name, family_name)',
    )
    .eq('event_id', eventId)
    .in('status', [...ACTIVE_STATUSES]);
  if (error) return [];
  return ((data ?? []) as unknown as RawAssignmentRow[])
    .map(toAssignmentRow)
    .filter((row) => row.name !== '');
}
