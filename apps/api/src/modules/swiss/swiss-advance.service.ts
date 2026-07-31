import { Injectable, Logger, Optional } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
// Value imports, not `import type`: Nest needs the runtime classes for DI
// metadata. With `import type` these resolve to undefined and every Swiss round
// silently stops advancing — see di-wiring.regression.test.ts.
import { SwissPairingService } from './swiss-pairing.service';
import { SwissRoundStateService } from './swiss-round-state.service';
import { parseSwissConfig } from './dto/swiss-config.dto';

/**
 * Automatic round advancement (decision 3).
 *
 * When the last bout of a Swiss round finishes, the next round pairs itself.
 * That is the behaviour organisers actually want — a Swiss round cannot be
 * paired until the previous one is scored, so anything manual means the event
 * stalls on someone remembering to press a button between every round.
 *
 * Invoked from MatchCompletionService, the single documented owner of "a match
 * finished". It is a third side effect INSIDE that owner, not a fifth call site
 * — the four completion paths (status PATCH, forfeit, point cap, clock end)
 * stay exactly as they are, which di-wiring.regression.test.ts asserts.
 *
 * Nothing here throws. A completion side effect must never fail the write that
 * triggered it: an exchange, a clock action or a status change has already
 * happened, and refusing it after the fact would lose a scored bout to a
 * pairing problem.
 */
@Injectable()
export class SwissAdvanceService {
  private readonly logger = new Logger(SwissAdvanceService.name);

  constructor(
    private readonly supabase: SupabaseService,
    @Optional() private readonly pairing?: SwissPairingService,
    @Optional() private readonly roundState?: SwissRoundStateService,
  ) {}

  /**
   * A match completed. If it was a Swiss match and it closed out its round,
   * pair the next one.
   *
   * A no-op for every non-Swiss match, which is the overwhelming majority —
   * one indexed read on `matches.swiss_round_id` and out.
   */
  async onMatchCompleted(matchId: string): Promise<void> {
    if (!this.pairing || !this.roundState) return;
    try {
      const round = await this.roundOf(matchId);
      if (!round) return;

      const status = await this.roundState.refresh(round.roundId);
      if (status !== 'completed') return;

      if (await this.isFinalised(round.phaseId)) {
        this.logger.log(`swiss phase ${round.phaseId} is finalised; not advancing`);
        return;
      }

      // commitNextRound returns null when the phase has run its configured
      // rounds, or when a concurrent completion already committed this one.
      const committed = await this.pairing.commitNextRound(round.phaseId);
      if (committed) {
        this.logger.log(
          `swiss auto-advance: phase=${round.phaseId} round=${committed.roundNumber}`,
        );
      }
    } catch (err) {
      this.logger.warn(`swiss auto-advance after match ${matchId} failed: ${describe(err)}`);
    }
  }

  private async roundOf(matchId: string): Promise<{ roundId: string; phaseId: string } | null> {
    const { data } = await this.supabase.service
      .from('matches')
      .select('swiss_round_id, swiss_rounds(phase_id)')
      .eq('id', matchId)
      .maybeSingle();
    const row = data as { swiss_round_id?: string | null; swiss_rounds?: unknown } | null;
    if (!row?.swiss_round_id) return null;

    // Many-to-one embeds come back as objects; normalise defensively.
    const embed = Array.isArray(row.swiss_rounds) ? row.swiss_rounds[0] : row.swiss_rounds;
    const phaseId = (embed as { phase_id?: string } | null)?.phase_id;
    return phaseId ? { roundId: row.swiss_round_id, phaseId } : null;
  }

  /**
   * A finalised phase has had its standings frozen and its podium resolved.
   * Pairing another round behind the organiser's back would silently unfreeze
   * it, so advancement stops until they explicitly resume.
   */
  private async isFinalised(phaseId: string): Promise<boolean> {
    const { data } = await this.supabase.service
      .from('phases')
      .select('config_json')
      .eq('id', phaseId)
      .maybeSingle();
    const config = parseSwissConfig((data as { config_json?: unknown } | null)?.config_json);
    return Boolean(config?.finalized);
  }
}

const describe = (err: unknown): string => (err instanceof Error ? err.message : String(err));
