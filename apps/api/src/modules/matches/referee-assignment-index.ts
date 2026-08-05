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

/** What a `referee_assignments.role` resolves to for display. */
export interface RefereeSkill {
  name: string;
  /** Design ColorToken (`'orange'`, `'blue'`, …) — NOT a hex value. */
  color: string;
}

/** Colour for a role whose skill row could not be resolved. */
const FALLBACK_SKILL_COLOR = 'slate';

interface RawAssignmentRow {
  scope_type: string;
  match_id: string | null;
  pool_id: string | null;
  lice_id: string | null;
  person_id: string | null;
  /** One of ACTIVE_STATUSES — the query filters on it, and now projects it too. */
  status?: string | null;
  /** A `referee_skills.id`, not a role enum — it may be a `custom-…` id. */
  role: string | null;
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
export function toAssignmentRow(
  raw: RawAssignmentRow,
  skillById: ReadonlyMap<string, RefereeSkill> = new Map(),
): RefereeAssignmentRow {
  const embed = raw.global_persons;
  const person: PersonEmbed | null = Array.isArray(embed) ? (embed[0] ?? null) : (embed ?? null);
  const name = `${person?.given_name ?? ''} ${person?.family_name ?? ''}`.trim();
  const skill = raw.role ? skillById.get(raw.role) : undefined;
  return {
    scopeType: raw.scope_type,
    matchId: raw.match_id,
    poolId: raw.pool_id,
    liceId: raw.lice_id,
    name,
    role: raw.role,
    // A deleted or event-scoped-elsewhere skill still has to render something;
    // the raw id beats a blank chip, and beats the hardcoded 3-entry label map
    // the public surfaces use, which shows custom skills as their id anyway.
    roleLabel: raw.role ? (skill?.name ?? raw.role) : null,
    roleColor: skill?.color ?? FALLBACK_SKILL_COLOR,
    // Defaulted, not required: rows reaching this helper have already passed the
    // ACTIVE_STATUSES filter, and the neutral 'assigned' is what an unprojected
    // row should read as — never 'confirmed', which would overstate the board.
    status: raw.status ?? 'assigned',
  };
}

/**
 * `referee_skills.id` → `{name, color}` for the ids given.
 *
 * Skills are global (`is_system`) or event-scoped, and `referee_assignments.role`
 * carries the id with no FK — so an id can legitimately resolve to nothing.
 */
export async function fetchRefereeSkillIndex(
  supabase: SupabaseClient,
  skillIds: readonly string[],
): Promise<Map<string, RefereeSkill>> {
  const byId = new Map<string, RefereeSkill>();
  const ids = Array.from(new Set(skillIds.filter((id) => !!id)));
  if (ids.length === 0) return byId;
  const { data, error } = await supabase
    .from('referee_skills')
    .select('id, name, color')
    .in('id', ids);
  if (error) return byId;
  for (const row of (data ?? []) as Array<{
    id: string;
    name: string | null;
    color: string | null;
  }>) {
    if (!row.name) continue;
    byId.set(row.id, { name: row.name, color: row.color ?? FALLBACK_SKILL_COLOR });
  }
  return byId;
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
      'scope_type, match_id, pool_id, lice_id, person_id, role, status, global_persons(given_name, family_name)',
    )
    .eq('event_id', eventId)
    .in('status', [...ACTIVE_STATUSES]);
  if (error) return [];
  const raw = (data ?? []) as unknown as RawAssignmentRow[];
  // One skills query for the event, however many assignments it holds.
  const skillById = await fetchRefereeSkillIndex(
    supabase,
    raw.map((row) => row.role).filter((role): role is string => !!role),
  );
  return raw.map((row) => toAssignmentRow(row, skillById)).filter((row) => row.name !== '');
}
