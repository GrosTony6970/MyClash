import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { teamTournamentNotSupported } from '../../common/entrant-kind-refusal';
import { storedKind } from '../events/tournament-kind';

/** The phase's Tournament kind (`tournaments.entrant_kind`, 0281). */
export const MANUAL_BOUT_KIND_READ = 'id, tournaments!inner(entrant_kind)';

/** The English sentence of the refusal below; clients translate its `reason`. */
const MANUAL_BOUT_REFUSED =
  'A bout of a team Tournament is not made by hand: its Pools make their bouts.';

/**
 * The manual bout create (`POST phases/:phaseId/matches`, no screen calls it) names its two sides
 * by Registration: it has no team path. A team Tournament is refused 409 with the 1b-1 reason
 * `team_tournament_not_supported` (call 8), before anything is placed or written. A read that finds
 * no kind throws (`storedKind`): it must not pass for an individual Tournament.
 */
export async function assertIndividualPhase(db: SupabaseClient, phaseId: string): Promise<void> {
  const { data, error } = await db
    .from('phases')
    .select(MANUAL_BOUT_KIND_READ)
    .eq('id', phaseId)
    .maybeSingle();
  if (error) throw new BadRequestException(error.message);
  if (!data) throw new NotFoundException(`Phase ${phaseId} not found`);
  const kind = (data as { tournaments?: { entrant_kind?: unknown } }).tournaments?.entrant_kind;
  if (storedKind(kind) === 'team') throw teamTournamentNotSupported(MANUAL_BOUT_REFUSED);
}
