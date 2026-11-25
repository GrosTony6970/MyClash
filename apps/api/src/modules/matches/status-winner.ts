import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { winnerColumns, type SideColumns } from './winner-columns';

/** The four side columns of a bout: a side is a Registration or a team (0282). */
export const STATUS_WINNER_READ =
  'red_registration_id, red_team_id, blue_registration_id, blue_team_id';

/**
 * The winner a manual completion names (`PATCH matches/:id/status`, call 8), as the columns of its
 * kind: a Fighter wins into `winner_registration_id`, a team into `winner_team_id`, and the other
 * is cleared (`winnerColumns`).
 *
 * The route took any uuid as the winner and wrote it. The bout's sides are read first, so a key
 * that is neither side of the bout (a team of another bout, say) is refused with a 400 and nothing
 * is written. The read and the write are two calls: a colour swap between them changes the colour
 * of each side, not its key or its kind, so the columns stay right.
 */
export async function statusWinnerColumns(
  db: SupabaseClient,
  matchId: string,
  winnerSideId: string,
): Promise<ReturnType<typeof winnerColumns>> {
  const { data, error } = await db
    .from('matches')
    .select(STATUS_WINNER_READ)
    .eq('id', matchId)
    .maybeSingle();
  if (error) throw new BadRequestException(error.message);
  if (!data) throw new NotFoundException(`Match ${matchId} not found`);
  try {
    return winnerColumns(data as SideColumns, winnerSideId);
  } catch (err) {
    throw new BadRequestException(err instanceof Error ? err.message : String(err));
  }
}
