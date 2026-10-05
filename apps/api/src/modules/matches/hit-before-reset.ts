import { ConflictException } from '@nestjs/common';
import type { SupabaseService } from '../supabase/supabase.service';

/**
 * A hit from before its bout's last reset is not restored (ruling 275).
 *
 * A reset voids every hit of a bout so that the bout is fought again. Each of
 * those hits still reads as "voided", and a restore would put it into a bout
 * nobody has fought yet. The same holds for a hit somebody voided by hand
 * before the reset: the bout it belonged to is gone.
 *
 * "Before the last reset" is read on the server's own two clocks of the API:
 * `exchanges.recorded_at` (when the hit was saved, never the pad's
 * `occurred_at`) against `occurred_at` of the bout's newest `reset_match` line.
 * Both reset paths write that line (`MatchesService.resetMatch`,
 * `revertMatchToUnplayed`). A reset voids the hits and THEN writes its line, so
 * a hit saved at the same instant is from before it; and a reset that fails
 * between the two leaves its hits restorable until it is run again.
 *
 * A failed read is a plain Error: "could not read" must not pass as "never
 * reset".
 */
export const EXCHANGE_FROM_BEFORE_RESET = 'exchange_from_before_reset';

/** The two columns of a hit the rule reads. */
export interface SavedHit {
  match_id: string;
  recorded_at: string;
}

/** When the bout was last reset, or null for a bout never reset. A failed read throws. */
async function lastResetAt(
  supabase: SupabaseService['service'],
  matchId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('match_events')
    .select('occurred_at')
    .eq('match_id', matchId)
    .eq('type', 'reset_match')
    .order('sequence', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new Error(`Could not read the resets of bout ${matchId}: ${error.message}`);
  }
  return (data as { occurred_at: string } | null)?.occurred_at ?? null;
}

/** The code of the refusal of `assertScoredAfterLastReset`. The pad says it. */
export const SCORED_BEFORE_RESET = 'scored_before_reset';

/**
 * A NEW hit or card scored before its bout's last reset is not taken (ruling 290).
 *
 * A pad keeps hits in a queue while it is offline. The bout is reset, and is
 * started again on another tablet before the pad reconnects: the old hits went
 * into the new fight with nobody looking. A hit the server has never seen has
 * no `recorded_at`, so this rule reads the PAD's time, `occurredAt`: a pad
 * whose clock is wrong can lose a good hit or keep an old one, and the operator
 * ruled that risk. Equal is "before", as for a restore.
 */
export async function assertScoredAfterLastReset(
  supabase: SupabaseService['service'],
  matchId: string,
  occurredAt: string,
): Promise<void> {
  const resetAt = await lastResetAt(supabase, matchId);
  if (!resetAt || Date.parse(occurredAt) > Date.parse(resetAt)) return;
  throw new ConflictException({
    message:
      'This was scored before the bout was reset. It belongs to the fight that was cancelled.',
    code: SCORED_BEFORE_RESET,
  });
}

export async function assertSavedAfterLastReset(
  supabase: SupabaseService['service'],
  hit: SavedHit,
): Promise<void> {
  const resetAt = await lastResetAt(supabase, hit.match_id);
  if (!resetAt || Date.parse(hit.recorded_at) > Date.parse(resetAt)) return;
  // The object form: web-admin says it by `code`, in the reader's language.
  throw new ConflictException({
    message: 'This exchange is from before the bout was reset. It cannot be restored.',
    code: EXCHANGE_FROM_BEFORE_RESET,
  });
}
