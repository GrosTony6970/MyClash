import { BadRequestException } from '@nestjs/common';
import type { SupabaseService } from '../supabase/supabase.service';
import { unplayedMatchColumns } from '../matches/unplayed-match-columns';

/**
 * Put one bout back to unplayed, from outside MatchesService.
 *
 * `MatchesService.resetMatch` is the operator-facing version of this: it owns
 * the confirmation phrase, the lock check and the HTTP shape. The cascade needs
 * the same effect on a bout the operator never named, from a service in
 * PhasesModule — and it cannot call MatchesService, because MatchesModule
 * imports PhasesModule and the edge back would close a cycle that
 * `module-graph.test.ts` fails on.
 *
 * A free function rather than a second service, so there is no module edge at
 * all, and it shares `unplayedMatchColumns` with `resetMatch` so the two cannot
 * drift on WHAT unplayed means. What differs is the authority: `resetMatch`
 * refuses a locked bout, and a cascade must instead take the lock off — the
 * operator has already been told the bout will be discarded, and auto-lock will
 * have stamped every completed bracket match within a minute of it finishing.
 *
 * THE `reset_match` EVENT IS NOT OPTIONAL. Clock state is replayed from
 * `match_events` and never stored, and that event is the only one that returns
 * the replay to `idle`. Skip it and the bout reads `scheduled` to every list
 * while the pad still sees `ended` — and `VALID_TRANSITIONS.ended` is
 * `['reopen']`, so it cannot be started. Written BEFORE the column update, the
 * order `resetMatch` uses.
 *
 * Every write is checked. There is no transaction, so a silent failure here is
 * a bout left half-reverted inside a loop that has already moved on.
 */

type Client = SupabaseService['service'];

export interface RevertActor {
  userId?: string;
  staffAccountId?: string;
}

export async function revertMatchToUnplayed(
  supabase: Client,
  matchId: string,
  reason: string,
  actor: RevertActor = {},
): Promise<void> {
  const voidedExchanges = await supabase
    .from('exchanges')
    .update({ voided: true, voided_reason: reason })
    .eq('match_id', matchId)
    .eq('voided', false);
  if (voidedExchanges.error) throw new BadRequestException(voidedExchanges.error.message);

  const voidedPenalties = await supabase
    .from('match_penalties')
    .update({ voided: true, voided_reason: reason })
    .eq('match_id', matchId)
    .eq('voided', false);
  if (voidedPenalties.error) throw new BadRequestException(voidedPenalties.error.message);

  await insertResetEvent(supabase, matchId, reason, actor);

  const { error } = await supabase.from('matches').update(unplayedMatchColumns()).eq('id', matchId);
  if (error) throw new BadRequestException(error.message);
}

/**
 * A `reset_match` row at the next sequence for the bout.
 *
 * Duplicated shape rather than a shared writer on purpose, for now: sequence
 * allocation against `UNIQUE(match_id, sequence)` already has two owners
 * (`MatchesService.insertMatchEvent` and `ClockService.nextSequence`) and a
 * third that only appends is cheaper than reshaping both. If a fourth appears,
 * that is the moment to extract one.
 */
async function insertResetEvent(
  supabase: Client,
  matchId: string,
  reason: string,
  actor: RevertActor,
): Promise<void> {
  const { data: last } = await supabase
    .from('match_events')
    .select('sequence')
    .eq('match_id', matchId)
    .order('sequence', { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await supabase.from('match_events').insert({
    match_id: matchId,
    sequence: ((last as { sequence?: number } | null)?.sequence ?? 0) + 1,
    type: 'reset_match',
    reason,
    by_user_id: actor.userId ?? null,
    staff_account_id: actor.staffAccountId ?? null,
    occurred_at: new Date().toISOString(),
  });
  if (error) throw new BadRequestException(error.message);
}
