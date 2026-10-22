import { BadRequestException, ConflictException } from '@nestjs/common';
import type { SwissRoundPlan } from '@myclash/rules/scheduling';
import type { MatchRulesetStamp } from '../phases/match-ruleset';
import type { SupabaseService } from '../supabase/supabase.service';
import { swissMatchRows } from './swiss-match-rows';

/**
 * The write of one planned Swiss round (migration 0243): the round and its bouts in ONE call,
 * `swiss_commit_round`, under the phase's row lock, which a withdraw takes too.
 *
 * The plan is read with no lock (the standings, the pairing engine), so the function re-checks the
 * field it was planned from: a withdraw landing between the plan and the write makes the answer
 * 'stale', and the caller plans again. Written in one transaction, a round never stands without
 * its bouts: the old insert of the round, then its bouts, left a round with no bouts when the
 * second call failed, and every retry met it as "already committed".
 */

/** What a plan of the next round is: its number, its pairings, and the field it was drawn from. */
export interface PlannedRound {
  roundNumber: number;
  plan: SwissRoundPlan;
  /** The active entrants the plan was drawn from (`activeEntrants`), the bye among them. */
  field: string[];
}

export type CommitAnswer =
  | { status: 'committed'; roundId: string; matchIds: string[] }
  | { status: 'exists'; roundId: string }
  | { status: 'stale' };

/** The code of a round the field kept changing under, plan after plan. */
export const SWISS_FIELD_CHANGED = 'swiss_field_changed';

/** How many plans a commit draws before it gives up on a field that keeps changing. */
export const COMMIT_TRIES = 3;

export function fieldChanged(): ConflictException {
  return new ConflictException({
    message: 'The field changed while the round was being paired: try again',
    code: SWISS_FIELD_CHANGED,
  });
}

/** Write the planned round and its bouts, or learn that it stands already or is stale. */
export async function writeRound(
  supabase: SupabaseService,
  phaseId: string,
  planned: PlannedRound,
  stamp: MatchRulesetStamp,
): Promise<CommitAnswer> {
  const { roundNumber, plan, field } = planned;
  const { data, error } = await supabase.service.rpc('swiss_commit_round', {
    p_phase: phaseId,
    p_round: roundNumber,
    p_field: field,
    p_bye: plan.byeRegistrationId,
    p_meta: {
      warnings: plan.warnings,
      ranked: plan.pairings.flatMap((p) => [p.aId, p.bId]),
      manualAdjustments: [],
      generatedAt: new Date().toISOString(),
    },
    p_bouts: swissMatchRows(roundNumber, plan, stamp),
  });
  if (error) throw new BadRequestException(error.message);
  if (!data) throw new BadRequestException(`Swiss round ${roundNumber} was answered nothing`);
  return data as CommitAnswer;
}
