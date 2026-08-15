import { BadRequestException, ConflictException, Logger } from '@nestjs/common';
import type { SupabaseService } from '../supabase/supabase.service';
import { hasBeenFought } from '../matches/fought-match';
import { matchRulesetForPhase } from './match-ruleset';

/**
 * "What should this slot's `matches` row say?", answered in one place.
 *
 * The row used to have two writers and a hole between them. `overrideSlot`
 * forked on the tri-state it receives: a `null` on EITHER side blanked the row
 * and returned, so a PATCH that swapped one fighter for another dropped the new
 * one; anything else went to a create-if-missing that returned early whenever a
 * row existed, so a blanked row could never be refilled. Neither branch could
 * reach the code that writes registrations into an existing row.
 *
 * Split out of BracketAdvanceService for the same reason `bracket-downstream.ts`
 * was — the service was over the file-length budget — and the split falls along
 * the same seam: one question, one owner.
 */

type Client = SupabaseService['service'];

const logger = new Logger('BracketMatchSync');

export interface SyncableSlot {
  id: string;
  phase_id: string;
  /** 1-indexed position within the round; stamped as `match_number_label`. */
  position?: number;
  source_b_type: string;
  registration_a_id: string | null;
  registration_b_id: string | null;
}

export interface SlotMatch {
  id: string;
  status: string;
  started_at: string | null;
}

/** 23505 — `matches_bracket_slot_id_active_uniq` lost a race. */
function isUniqueViolation(error: { code?: string; message?: string }): boolean {
  if (error.code === '23505') return true;
  const message = error.message ?? '';
  return message.includes('duplicate key') || message.includes('unique constraint');
}

/** The live (non-voided) matches row for a slot, if any. */
export async function loadSlotMatch(supabase: Client, slotId: string): Promise<SlotMatch | null> {
  // `.limit(1)` before `.maybeSingle()`: pre-0094 data can carry two non-voided
  // rows for one slot, and a bare maybeSingle ERRORS on that — which the old
  // idempotency probe turned into `existing = null`, then INSERTed straight
  // into the unique index.
  const { data } = await supabase
    .from('matches')
    .select('id, status, started_at')
    .eq('bracket_slot_id', slotId)
    .not('status', 'eq', 'voided')
    .limit(1)
    .maybeSingle();
  return (data as SlotMatch | null) ?? null;
}

/** True once a bout is in play or decided — its pairing is no longer ours. */
export function hasStarted(match: SlotMatch): boolean {
  return hasBeenFought(match.status, match.started_at);
}

/**
 * Refuse an operator slot edit whose match is already under way.
 *
 * Called BEFORE the slot is written, so a refusal cannot leave the slot changed
 * and the match not. There is no transaction through supabase-js; ordering is
 * the whole guarantee.
 */
export async function assertSlotMatchRewritable(supabase: Client, slotId: string): Promise<void> {
  const match = await loadSlotMatch(supabase, slotId);
  if (match && hasStarted(match)) {
    throw new ConflictException(
      `Match ${match.id} has already started — clear its result before changing the slot`,
    );
  }
}

/**
 * Make the matches row describe the slot as it is NOW.
 *
 * Never deletes and never voids. The row may carry an operator-placed `lice_id`
 * + `scheduled_at` from bracket generation, so a cleared side is an UPDATE to
 * null — removing the row would drop the chip off the schedule grid and lose
 * that placement.
 *
 * `onStarted` differs by caller on purpose: advancement is automatic and runs
 * inside a catch that only logs, so a started bout must be skipped rather than
 * abort the other downstream slots in its loop; an operator clicked Save, so
 * they get a 409.
 */
export async function syncMatchToSlot(
  supabase: Client,
  slot: SyncableSlot,
  opts: { onStarted: 'skip' | 'throw' },
): Promise<void> {
  // Byes never get a match — the generator says there is no bout here, and an
  // operator writing a side onto a bye slot must not conjure one.
  if (slot.source_b_type === 'bye') return;

  const existing = await loadSlotMatch(supabase, slot.id);

  if (existing && hasStarted(existing)) {
    if (opts.onStarted === 'throw') {
      throw new ConflictException(
        `Match ${existing.id} has already started — clear its result before changing the slot`,
      );
    }
    logger.warn(
      `Slot ${slot.id} changed while match ${existing.id} is ${existing.status} — row left alone`,
    );
    return;
  }

  if (existing) {
    const { error } = await supabase
      .from('matches')
      .update({
        red_registration_id: slot.registration_a_id,
        blue_registration_id: slot.registration_b_id,
      })
      .eq('id', existing.id);
    if (error) throw new BadRequestException(error.message);
    return;
  }

  // No row yet: only worth creating once both fighters are known.
  if (!slot.registration_a_id || !slot.registration_b_id) return;
  await insertMatchForSlot(supabase, slot, opts);
}

/**
 * Create the slot's matches row, converging rather than throwing on a race.
 *
 * The old INSERT never checked its error at all, so a 23505 from a concurrent
 * advance was swallowed and still logged "Created match for bracket slot X" — a
 * write that never happened, reported as one that did.
 */
async function insertMatchForSlot(
  supabase: Client,
  slot: SyncableSlot,
  opts: { onStarted: 'skip' | 'throw' },
): Promise<void> {
  const { error } = await supabase.from('matches').insert({
    phase_id: slot.phase_id,
    bracket_slot_id: slot.id,
    red_registration_id: slot.registration_a_id,
    blue_registration_id: slot.registration_b_id,
    status: 'scheduled',
    red_score: 0,
    blue_score: 0,
    // Tournament's ruleset, not a hardcoded TF_v1 — scoring reads the match row.
    ...(await matchRulesetForPhase(supabase, slot.phase_id)),
    match_number_label: typeof slot.position === 'number' ? String(slot.position) : null,
  });
  if (!error) {
    logger.log(`Created match for bracket slot ${slot.id}`);
    return;
  }
  // Somebody else inserted first. Sync to their row — the recursion terminates
  // because that row now exists.
  if (isUniqueViolation(error)) {
    logger.log(`Slot ${slot.id} match created concurrently — syncing to it`);
    await syncMatchToSlot(supabase, slot, opts);
    return;
  }
  throw new BadRequestException(error.message);
}
