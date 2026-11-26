/**
 * The check for changing the sides of a bracket slot.
 *
 * A slot carries no Event: the chain is slot → phase → tournament → Event, read
 * from the rows, never taken from the caller. The bar is `admin` (operator
 * ruling 33, 2026-09-19), as for generating, filling, reseeding and deleting a
 * bracket and for adding or removing a Pool member, and as RLS
 * `bracket_slots_write` said until 0247 dropped it. That policy also admitted a
 * super admin; the API does not, like every Event check in `event-authz.ts`.
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { SupabaseService } from '../../modules/supabase/supabase.service';
import { storedKind } from '../../modules/events/tournament-kind';
import type { SlotEntrant } from '../../modules/phases/bracket-advance.service';
import { entrantKindMismatch } from '../entrant-kind-refusal';
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
 * Assert the caller may put `sides` into the slot (null empties a side, undefined leaves it):
 * `admin` on its Event; every entrant named of the Tournament's kind, else 409
 * `entrant_kind_mismatch` (a Fighter is never written into a team bracket, nor a team into an
 * individual one); every Registration entered in the slot's own Tournament and every team one of
 * its teams, else one 400 for "elsewhere" and "unknown". The database does not tie a slot's team to
 * its Tournament, so this check is the guard. All of it after the role check.
 */
export async function assertCanFillBracketSlot(
  deps: EventAuthzDeps,
  slotId: string,
  sides: ReadonlyArray<SlotEntrant | null | undefined>,
  userId: string,
): Promise<void> {
  const tournamentId = await tournamentIdForBracketSlot(deps.supabase, slotId);
  await assertCanManageTournament(deps, tournamentId, userId, 'admin');
  const named = sides.filter((side): side is SlotEntrant => side != null);
  if (named.length === 0) return;
  const kind = await tournamentKind(deps.supabase, tournamentId);
  if (named.some((side) => side.kind !== kind)) throw entrantKindMismatch();
  if (kind === 'team') {
    await assertTeamsOfTournament(
      deps.supabase,
      tournamentId,
      named.map((side) => side.id),
    );
    return;
  }
  await assertEnteredInTournament(
    deps.supabase,
    tournamentId,
    named.map((side) => side.id),
    'A fighter in a bracket slot must be entered in its tournament',
  );
}

/** The Tournament's kind of entrant (`storedKind`: throws when it was not read). */
async function tournamentKind(supabase: SupabaseService, tournamentId: string) {
  const { data, error } = await supabase.service
    .from('tournaments')
    .select('entrant_kind')
    .eq('id', tournamentId)
    .maybeSingle();
  if (error) throw new BadRequestException(error.message);
  return storedKind((data as { entrant_kind?: unknown } | null)?.entrant_kind);
}

/** Every team named is one of the Tournament's: another's and an unknown id get one 400. */
async function assertTeamsOfTournament(
  supabase: SupabaseService,
  tournamentId: string,
  teamIds: readonly string[],
): Promise<void> {
  const { data, error } = await supabase.service
    .from('teams')
    .select('id')
    .eq('tournament_id', tournamentId)
    .in('id', teamIds);
  if (error) throw new BadRequestException(error.message);
  const ours = new Set(((data ?? []) as Array<{ id: string }>).map((row) => row.id));
  if (teamIds.some((id) => !ours.has(id))) {
    throw new BadRequestException('A team in a bracket slot must be one of its tournament');
  }
}
