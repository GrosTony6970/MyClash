import { BadRequestException } from '@nestjs/common';
import type { SupabaseService } from '../supabase/supabase.service';
import { buildSelfRef, type PhaseConfig } from './bracket-refs';

/**
 * "What depends on this match?", answered once.
 *
 * `advanceFromSlot` finds successors by matching `winner of <selfRef>` /
 * `loser of <selfRef>` against the downstream slots' source refs. Every other
 * caller that needs the same answer — voiding a forfeit, overriding a
 * completed result — has to ask it the same way. Asking it a second way (by
 * round number, or by which slot happens to hold the winner) gets byes and
 * losers brackets wrong, which is why this lives beside `bracket-refs.ts`
 * rather than being re-derived per caller.
 *
 * Split out of BracketAdvanceService because the service was over the
 * file-length budget; the loaders came with it so nothing is duplicated.
 */

type Client = SupabaseService['service'];

export interface DownstreamSlot {
  id: string;
  source_a_ref: string | null;
  source_b_ref: string | null;
}

export interface Downstream {
  winnerRef: string;
  loserRef: string;
  slots: DownstreamSlot[];
}

/**
 * The slots fed by `matchId`, with the two refs that name them.
 *
 * Null only when there is nothing to resolve FROM: a pool match, or a missing
 * row. Deliberately NOT gated on `winner_registration_id` — the refs are built
 * from the slot's own round and position, so the winner is not an input here.
 *
 * That distinction is load-bearing. `onMatchCompleted` needs a winner because
 * it has one to propagate; a CALLER ASKING WHAT DEPENDS ON THIS MATCH does not.
 * Copying the winner check into this lookup made the override guard blind on
 * exactly the matches that most need it — a bracket bout completed with no
 * winner, which is every bout that ends on the clock or on max-doubles
 * (`clock.service.ts` end, `scoring.service.ts` time_limit / max_doubles). The
 * guard ran before the winner was written and saw nothing; the destructive
 * clear ran after and saw everything.
 */
export async function downstreamSlots(
  supabase: Client,
  matchId: string,
): Promise<Downstream | null> {
  const match = await loadMatch(supabase, matchId);
  if (!match?.bracket_slot_id) return null;

  const slot = await loadSlot(supabase, match.bracket_slot_id);
  if (!slot) return null;

  const phase = await loadPhase(supabase, slot.phase_id);
  if (!phase) return null;

  const config = (phase.config_json ?? {}) as PhaseConfig;
  const selfRef = buildSelfRef(slot.round, slot.position, phase.type as string, config);
  const winnerRef = `winner of ${selfRef}`;
  const loserRef = `loser of ${selfRef}`;

  const { data } = await supabase
    .from('bracket_slots')
    .select('id, source_a_ref, source_b_ref')
    .eq('phase_id', slot.phase_id)
    .or(
      `source_a_ref.eq.${winnerRef},source_b_ref.eq.${winnerRef},source_a_ref.eq.${loserRef},source_b_ref.eq.${loserRef}`,
    );

  return { winnerRef, loserRef, slots: (data ?? []) as DownstreamSlot[] };
}

/** The match ids this one feeds. Empty for a pool match or a bracket leaf. */
export async function findDownstreamMatchIds(supabase: Client, matchId: string): Promise<string[]> {
  const downstream = await downstreamSlots(supabase, matchId);
  if (!downstream || downstream.slots.length === 0) return [];

  const { data } = await supabase
    .from('matches')
    .select('id')
    .in(
      'bracket_slot_id',
      downstream.slots.map((slot) => slot.id),
    );

  return ((data ?? []) as Array<{ id: string }>).map((row) => row.id);
}

/**
 * Un-resolve the sides this match feeds, so advancement can fill them again.
 *
 * Needed when a COMPLETED bracket match changes winner — a result override.
 * `advanceFromSlot` writes a downstream side only while it is still null, on
 * purpose: that is what makes re-advancement idempotent. The same guard makes
 * a re-run after a winner change a silent no-op, leaving the bracket carrying
 * a fighter who did not win. Clearing first is what turns the second call into
 * a real re-advance.
 *
 * Only the slot side is cleared, not the downstream matches row —
 * `writeSlotSide` overwrites that column unconditionally on the way back in.
 *
 * The caller must have established that no dependent match has started;
 * clearing a side under a bout in progress would be a different bug.
 */
export async function clearDownstreamOf(supabase: Client, matchId: string): Promise<void> {
  const downstream = await downstreamSlots(supabase, matchId);
  if (!downstream) return;
  await clearFedSides(supabase, downstream);
}

/** Null every side of these slots that this match's winner/loser refs feed. */
async function clearFedSides(supabase: Client, downstream: Downstream): Promise<void> {
  const { winnerRef, loserRef, slots } = downstream;

  for (const slot of slots) {
    const patch: Record<string, null> = {};
    if (slot.source_a_ref === winnerRef || slot.source_a_ref === loserRef) {
      patch['registration_a_id'] = null;
    }
    if (slot.source_b_ref === winnerRef || slot.source_b_ref === loserRef) {
      patch['registration_b_id'] = null;
    }
    if (Object.keys(patch).length === 0) continue;

    const { error } = await supabase.from('bracket_slots').update(patch).eq('id', slot.id);
    if (error) throw new BadRequestException(error.message);
  }
}

/**
 * Un-make the grand-final reset once the grand final has ENDED the bracket.
 *
 * The reset is the one slot generated without a placeholder `matches` row
 * (`phases.service.ts` createInitialBracketMatches skips it, and
 * `syncGrandFinalResetSlot` relies on the same assumption), because it is only
 * played when the losers-bracket entrant wins. So when they do, the row is
 * created on demand — and when that result is later changed to a
 * winners-bracket win, `grandFinalEndsBracket` merely SKIPS advancement.
 *
 * Skipping is not enough. The created row survives as a `scheduled` bout still
 * naming both finalists: it shows on the schedule grid, the live board and the
 * public schedule, `events.service.ts` hands the bracket view a non-null
 * matchId for a slot that must have none, and nothing validates a match against
 * its slot before the pad starts it. The refill that would have corrected the
 * row is exactly what the early return skips.
 *
 * Called from `onMatchCompleted` rather than from `clearDownstreamOf`, because
 * three paths reach this state without ever clearing: `POST /matches/:id/reset`
 * on the grand final, the clock's `reopen` (which clears the winner on a
 * best-of), and `PATCH /matches/:id/status`. `grandFinalEndsBracket` is the
 * single owner of the predicate, so the retraction belongs beside it.
 *
 * Only the reset is reachable from here: the grand final's self-ref is `GF`,
 * and the generator points nothing but the reset slot at `winner of GF` /
 * `loser of GF`. The caller has already established `grandFinalEndsBracket`.
 */
export async function retractGrandFinalReset(supabase: Client, matchId: string): Promise<void> {
  const downstream = await downstreamSlots(supabase, matchId);
  if (!downstream || downstream.slots.length === 0) return;

  await clearFedSides(supabase, downstream);
  for (const slot of downstream.slots) {
    await deleteUnplayedSlotMatch(supabase, slot.id);
  }
}

/**
 * Drop a slot's never-played `matches` row.
 *
 * Its `referee_assignments` go with it through the FK. That used to need a
 * hand-rolled delete first: the FK was ON DELETE SET NULL while
 * `referee_assignments_scope_check` (0091) forbids a null `match_id` at
 * `scope_type='match'`, and Postgres validates CHECKs on the SET NULL action,
 * so the delete ABORTED rather than orphaning anything. Migration 0179 makes
 * the FK CASCADE, which is the only action that agrees with that CHECK — and
 * puts the rule in one place instead of at each of nine delete sites.
 *
 * DELETE, not `status='voided'`: the readers here are status-blind — the
 * schedule grid filters nothing, not even 'voided' — so voiding hides the row
 * from the unique index and not from the operator, and would additionally let
 * `createMatchIfReady` insert a SECOND row for the same slot.
 *
 * Contrast `BracketAdvanceService.deleteUnstartedMatch`, which despite its name
 * is an UPDATE: its row is a generation-time placeholder carrying the
 * operator's schedule placement and has to survive. This one must not exist at
 * all. Scoped to scheduled + never started, so a reset that carries a real
 * result is left for the caller's started-dependents guard to refuse rather
 * than destroyed here.
 */
async function deleteUnplayedSlotMatch(supabase: Client, slotId: string): Promise<void> {
  const { data } = await supabase
    .from('matches')
    .select('id')
    .eq('bracket_slot_id', slotId)
    .eq('status', 'scheduled')
    .is('started_at', null);
  const ids = ((data ?? []) as Array<{ id: string }>).map((row) => row.id);
  if (ids.length === 0) return;

  const removed = await supabase.from('matches').delete().in('id', ids);
  if (removed.error) throw new BadRequestException(removed.error.message);
}

// ── Loaders ─────────────────────────────────────────────────────────────────

export async function loadMatch(supabase: Client, matchId: string) {
  const { data } = await supabase
    .from('matches')
    .select(
      'id, bracket_slot_id, winner_registration_id, red_registration_id, blue_registration_id',
    )
    .eq('id', matchId)
    .maybeSingle();
  return data as {
    id: string;
    bracket_slot_id: string | null;
    winner_registration_id: string | null;
    red_registration_id: string;
    blue_registration_id: string;
  } | null;
}

export async function loadSlot(supabase: Client, slotId: string) {
  const { data } = await supabase
    .from('bracket_slots')
    .select('id, round, position, phase_id, source_b_type, registration_a_id, registration_b_id')
    .eq('id', slotId)
    .maybeSingle();
  return data as {
    id: string;
    round: number;
    position: number;
    phase_id: string;
    source_b_type: string;
    registration_a_id: string | null;
    registration_b_id: string | null;
  } | null;
}

export async function loadPhase(supabase: Client, phaseId: string) {
  const { data } = await supabase
    .from('phases')
    .select('id, type, config_json')
    .eq('id', phaseId)
    .maybeSingle();
  return data as { id: string; type: unknown; config_json: unknown } | null;
}
