/**
 * The check for changing the fighters in a bracket slot.
 *
 * A slot carries no Event: the chain is slot → phase → tournament → Event, read
 * from the rows, never taken from the caller. The bar is `admin` (operator
 * ruling 33, 2026-09-19), as for generating, filling, reseeding and deleting a
 * bracket and for adding or removing a Pool member, and as RLS
 * `bracket_slots_write` says. That policy also admits a super admin; the API
 * does not, like every Event check in `event-authz.ts`.
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { SupabaseService } from '../../modules/supabase/supabase.service';
import type { EventAuthzDeps } from './event-authz';
import {
  assertCanManageTournament,
  assertEnteredInTournament,
  tournamentIdForPhase,
} from './registration-authz';

async function tournamentIdForBracketSlot(
  supabase: SupabaseService,
  slotId: string,
): Promise<string> {
  const { data: slot, error } = await supabase.service
    .from('bracket_slots')
    .select('phase_id')
    .eq('id', slotId)
    .maybeSingle();
  if (error) throw new BadRequestException(error.message);
  const missing = `Bracket slot ${slotId} not found`;
  if (!slot) throw new NotFoundException(missing);
  return tournamentIdForPhase(supabase, (slot as { phase_id: string }).phase_id, missing);
}

/**
 * Assert the caller may put `registrationIds` into the slot: `admin` on its
 * Event, and every registration named (null empties a side) entered in the
 * slot's own tournament — one 400 for "elsewhere" and "unknown", only after the
 * role check.
 */
export async function assertCanFillBracketSlot(
  deps: EventAuthzDeps,
  slotId: string,
  registrationIds: ReadonlyArray<string | null | undefined>,
  userId: string,
): Promise<void> {
  const tournamentId = await tournamentIdForBracketSlot(deps.supabase, slotId);
  await assertCanManageTournament(deps, tournamentId, userId, 'admin');
  await assertEnteredInTournament(
    deps.supabase,
    tournamentId,
    registrationIds,
    'A fighter in a bracket slot must be entered in its tournament',
  );
}
