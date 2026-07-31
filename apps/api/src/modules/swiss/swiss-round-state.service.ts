import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

/**
 * `swiss_rounds.status` transitions, driven by the matches in the round.
 *
 * The status is not a workflow of its own — it is a projection of the bouts:
 *   pending   — nothing has started. The round is still fully editable.
 *   running   — a bout has started. Edits close here.
 *   completed — every bout has finished.
 *
 * That is what implements decision 3's "override window" with no new state to
 * keep in sync. There is no organiser action that opens or closes editing; the
 * first fighter to step on the piste closes it, which is the moment a pairing
 * change stops being an adjustment and starts being a rewrite of history.
 */
@Injectable()
export class SwissRoundStateService {
  private readonly logger = new Logger(SwissRoundStateService.name);

  constructor(private readonly supabase: SupabaseService) {}

  /**
   * Recompute one round's status from its matches and persist any change.
   *
   * Returns the resulting status so a caller that just completed a match can
   * decide whether to advance without a second read.
   */
  async refresh(roundId: string): Promise<'pending' | 'running' | 'completed' | null> {
    const { data, error } = await this.supabase.service
      .from('swiss_rounds')
      .select('id, status, matches(status)')
      .eq('id', roundId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) return null;

    const row = data as { status: string; matches?: Array<{ status: string }> };
    const statuses = (row.matches ?? []).map((m) => m.status);
    const next = deriveRoundStatus(statuses);

    if (next !== row.status) {
      const { error: updateError } = await this.supabase.service
        .from('swiss_rounds')
        .update({ status: next })
        .eq('id', roundId);
      if (updateError) throw new BadRequestException(updateError.message);
      this.logger.log(`swiss round ${roundId} ${row.status} → ${next}`);
    }
    return next;
  }

  /** True when the round is still `pending`, i.e. open to pairing edits. */
  async isEditable(roundId: string): Promise<boolean> {
    const { data } = await this.supabase.service
      .from('swiss_rounds')
      .select('status')
      .eq('id', roundId)
      .maybeSingle();
    return (data as { status?: string } | null)?.status === 'pending';
  }
}

/**
 * Round status from its match statuses. Pure, so the rule is testable without
 * a database and reads as one expression rather than three queries.
 *
 * A round with no matches at all is `pending`, not `completed`: an empty round
 * is one that has just been created, and calling it complete would let the
 * phase advance straight past it.
 */
export function deriveRoundStatus(matchStatuses: string[]): 'pending' | 'running' | 'completed' {
  if (matchStatuses.length === 0) return 'pending';
  if (matchStatuses.every((s) => s === 'completed')) return 'completed';
  // `voided` counts as untouched — a voided bout is one that did not happen,
  // so it cannot be what makes the round look started.
  if (matchStatuses.every((s) => s === 'scheduled' || s === 'voided')) return 'pending';
  return 'running';
}
