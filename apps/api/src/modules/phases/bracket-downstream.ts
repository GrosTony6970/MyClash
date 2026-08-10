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
 * Null when the match feeds nothing resolvable: a pool match, an unfinished
 * match, or a missing row.
 */
export async function downstreamSlots(
  supabase: Client,
  matchId: string,
): Promise<Downstream | null> {
  const match = await loadMatch(supabase, matchId);
  if (!match?.bracket_slot_id || !match.winner_registration_id) return null;

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
