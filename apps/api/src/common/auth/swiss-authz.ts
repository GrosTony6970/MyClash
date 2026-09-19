/**
 * The Swiss write bar, and the check for writing both sides of a Swiss match —
 * the set-sides escape hatch, the one Swiss write that names its fighters freely.
 *
 * A match carries no Event: the chain is match → phase → tournament → Event,
 * read from the rows, never taken from the caller.
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { EventAuthzDeps, OrgRole } from './event-authz';
import {
  assertCanManageTournament,
  assertEnteredInTournament,
  tournamentIdForPhase,
} from './registration-authz';

/**
 * Every Swiss write needs `admin` on the Event (operator ruling 34,
 * 2026-09-19), as RLS `phases_write`, `swiss_rounds_write` and
 * `swiss_entrants_write` say, and as generating, filling, reseeding and deleting
 * a bracket and every Pool edit do. Adding one bout to a phase (`createMatch`)
 * needs only `editor`. The two Swiss reads need any member.
 */
export const SWISS_WRITE_ROLE: OrgRole = 'admin';

/**
 * Assert the caller may seat `registrationIds` in the match: `admin` on its
 * Event, and every registration named (null empties a side) entered in the
 * match's own tournament — one 400 for "elsewhere" and "unknown", only after
 * the role check.
 */
export async function assertCanSetSwissSides(
  deps: EventAuthzDeps,
  matchId: string,
  registrationIds: ReadonlyArray<string | null>,
  userId: string,
): Promise<void> {
  const { data, error } = await deps.supabase.service
    .from('matches')
    .select('phase_id')
    .eq('id', matchId)
    .maybeSingle();
  if (error) throw new BadRequestException(error.message);
  const missing = `Swiss match ${matchId} not found`;
  if (!data) throw new NotFoundException(missing);
  const phaseId = (data as { phase_id: string }).phase_id;
  const tournamentId = await tournamentIdForPhase(deps.supabase, phaseId, missing);
  await assertCanManageTournament(deps, tournamentId, userId, SWISS_WRITE_ROLE);
  await assertEnteredInTournament(
    deps.supabase,
    tournamentId,
    registrationIds,
    'A fighter in a Swiss bout must be entered in its tournament',
  );
}
