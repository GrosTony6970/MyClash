import { Injectable, Logger, Optional } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
// Value imports, not `import type`: Nest needs the runtime classes for DI metadata.
import { BracketAdvanceService } from './bracket-advance.service';
import { PhasesService } from './phases.service';
import { SwissAdvanceService } from '../swiss/swiss-advance.service';

/**
 * The single owner of "a match just completed".
 *
 * A match can complete down four different paths — `PATCH /matches/:id/status`,
 * the ruleset engine closing on the point cap, the clock's `end` action, and a
 * forfeit — and each one needs the same side effects: advance the bracket,
 * (for a pool match) try to auto-populate the bracket now the pools may be
 * finished, and (for a Swiss match) pair the next round if this one just
 * closed.
 *
 * Wiring those by hand at each call site kept going wrong, silently, because a
 * missing call looks like nothing at all:
 *   - advancement was wired ONLY to the status endpoint and forfeits, so a
 *     bracket scored on the pad never advanced its winner;
 *   - after that was fixed, the auto-populate sibling sitting on the very next
 *     line was still missed, so scoring the last pool match on the pad left the
 *     bracket empty.
 *
 * Both are the same defect: side effects owned by call sites rather than by the
 * event. This service exists so there is exactly ONE thing to call.
 * `di-wiring.regression.test.ts` asserts every completion path calls it;
 * `match-completion.service.test.ts` asserts it then performs BOTH side effects.
 *
 * Deliberately a leaf: it depends on BracketAdvanceService and PhasesService and
 * nothing depends back on it. It cannot live on MatchesService, which already
 * injects ScoringService — injecting MatchesService into scoring would close a
 * cycle.
 */
@Injectable()
export class MatchCompletionService {
  private readonly logger = new Logger(MatchCompletionService.name);

  constructor(
    private readonly supabase: SupabaseService,
    @Optional() private readonly bracketAdvance?: BracketAdvanceService,
    @Optional() private readonly phases?: PhasesService,
    @Optional() private readonly swissAdvance?: SwissAdvanceService,
  ) {}

  /**
   * Run every side effect a completed match owes. Safe to call more than once
   * for the same match: advancement only fills slot sides that are still null,
   * and populateBracket's own gate makes a repeat a no-op.
   *
   * Never throws — a completion side effect must not fail the write that
   * triggered it (an exchange, a clock action, a status change).
   */
  async onMatchCompleted(matchId: string): Promise<void> {
    await this.advance(matchId);
    await this.maybePopulateBracket(matchId);
    await this.maybeAdvanceSwiss(matchId);
  }

  private async advance(matchId: string): Promise<void> {
    try {
      await this.bracketAdvance?.onMatchCompleted(matchId);
    } catch (err) {
      // onMatchCompleted already swallows its own errors; this is belt-and-braces
      // so a future change there can never take the caller down with it.
      this.logger.warn(`Bracket advance after match ${matchId} failed: ${describe(err)}`);
    }
  }

  /**
   * After a SWISS match completes, pair the next round if this one just closed.
   *
   * A third side effect INSIDE the single owner, not a fifth call site: the
   * four completion paths are unchanged, which is what
   * di-wiring.regression.test.ts asserts. SwissAdvanceService swallows its own
   * errors and no-ops for every non-Swiss match.
   */
  private async maybeAdvanceSwiss(matchId: string): Promise<void> {
    try {
      await this.swissAdvance?.onMatchCompleted(matchId);
    } catch (err) {
      this.logger.warn(`Swiss advance after match ${matchId} failed: ${describe(err)}`);
    }
  }

  /**
   * After a POOL match completes, try to auto-populate the bracket. Gated by
   * populateBracket itself: a silent no-op if the pools aren't all complete or
   * any round-1 match has already started.
   */
  private async maybePopulateBracket(matchId: string): Promise<void> {
    if (!this.phases) return;
    try {
      const { data } = await this.supabase.service
        .from('matches')
        .select('phases!inner(type, tournament_id)')
        .eq('id', matchId)
        .maybeSingle();
      const phaseEmbed = (data as { phases?: unknown } | null)?.phases;
      // Many-to-one embeds are objects; normalize defensively (embed-flip gotcha).
      const phase = Array.isArray(phaseEmbed) ? phaseEmbed[0] : phaseEmbed;
      const type = (phase as { type?: string } | null)?.type;
      const tournamentId = (phase as { tournament_id?: string } | null)?.tournament_id;
      // A SWISS match can also be the one that fills a bracket: in a
      // Swiss → elimination tournament the cut is taken from the Swiss
      // standings, so the last Swiss bout is what makes the bracket seedable.
      // populateBracket's own gate makes this a no-op until the phase is
      // actually finished, so calling it on every Swiss completion is safe.
      if ((type !== 'pool' && type !== 'swiss') || !tournamentId) return;
      await this.phases.populateBracket(tournamentId, {}, 'system', { silentIfGateNotMet: true });
    } catch (err) {
      this.logger.warn(`Auto-populate after pool match ${matchId} failed: ${describe(err)}`);
    }
  }
}

const describe = (err: unknown): string => (err instanceof Error ? err.message : String(err));
