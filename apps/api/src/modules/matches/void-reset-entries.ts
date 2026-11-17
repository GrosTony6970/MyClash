import { BadRequestException } from '@nestjs/common';
import type { SupabaseService } from '../supabase/supabase.service';

/** The tables a reset voids beside the hits, in this order. */
const RESET_ENTRY_TABLES = ['match_penalties', 'match_protests'] as const;

/**
 * What a reset voids beside the bout's hits: its cards, and its protests (a bout fought again
 * starts at zero protests, the protest counter's design, call 3).
 *
 * One owner for both reset paths, `MatchesService.resetMatch` and `revertMatchToUnplayed`, as
 * `unplayedMatchColumns` is for what "unplayed" means. The hits are voided apart: `resetMatch`
 * closes the edit requests that wait on them before this runs. Each write is checked; there is no
 * transaction: a failed void throws a 400 and the reset stops there.
 */
export async function voidResetEntries(
  supabase: SupabaseService['service'],
  matchId: string,
  reason: string,
): Promise<void> {
  for (const table of RESET_ENTRY_TABLES) {
    const { error } = await supabase
      .from(table)
      .update({ voided: true, voided_reason: reason })
      .eq('match_id', matchId)
      .eq('voided', false);
    if (error) throw new BadRequestException(error.message);
  }
}
