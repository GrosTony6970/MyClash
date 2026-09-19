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
import { assertCanManageTournament } from './registration-authz';

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
  if (!slot) throw new NotFoundException(`Bracket slot ${slotId} not found`);
  const { data: phase, error: phaseError } = await supabase.service
    .from('phases')
    .select('tournament_id')
    .eq('id', (slot as { phase_id: string }).phase_id)
    .maybeSingle();
  if (phaseError) throw new BadRequestException(phaseError.message);
  if (!phase) throw new NotFoundException(`Bracket slot ${slotId} not found`);
  return String((phase as { tournament_id: string }).tournament_id);
}

/**
 * Assert the caller may put `registrationIds` into the slot: `admin` on its
 * Event, and every registration named (null empties a side) entered in the
 * slot's own tournament.
 *
 * The same 400 for a registration of another tournament and for no such
 * registration, and only after the role check: a 403 or a 404 would tell the
 * caller which ids exist elsewhere.
 */
export async function assertCanFillBracketSlot(
  deps: EventAuthzDeps,
  slotId: string,
  registrationIds: ReadonlyArray<string | null | undefined>,
  userId: string,
): Promise<void> {
  const tournamentId = await tournamentIdForBracketSlot(deps.supabase, slotId);
  await assertCanManageTournament(deps, tournamentId, userId, 'admin');
  const named = registrationIds.filter((id): id is string => typeof id === 'string');
  if (named.length === 0) return;
  const { data, error } = await deps.supabase.service
    .from('registrations')
    .select('id')
    .eq('tournament_id', tournamentId)
    .in('id', named);
  if (error) throw new BadRequestException(error.message);
  const entered = new Set(((data ?? []) as Array<{ id: string }>).map((row) => row.id));
  if (named.some((id) => !entered.has(id))) {
    throw new BadRequestException('A fighter in a bracket slot must be entered in its tournament');
  }
}
