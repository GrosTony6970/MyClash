import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { hasBeenFought } from '../matches/fought-match';
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

      // ONLY THE FRONTIER ROUND ADVANCES. `planNextRound` computes
      // `rounds.length + 1` over every round the phase has, so it pairs "one
      // past however many exist" — not "the one after this". Re-closing an
      // EARLIER round therefore commits a round that skips the ones between,
      // schedules pistes for it and pushes `swiss_round_published` to the whole
      // field. Reachable without any un-completion: `PATCH /matches/:id/status`
      // on an already-completed bout runs this path again.
      if (await this.hasLaterRound(round.phaseId, round.roundNumber)) {
        this.logger.log(
          `swiss round ${round.roundNumber} of phase ${round.phaseId} is not the frontier; not advancing`,
        );
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

  /**
   * Refuse an un-completion whose round has already been superseded.
   *
   * READ-ONLY, and called in the owner's assert phase — a refusal raised after
   * `revertMatchToUnplayed` has run is a half-applied cascade with no
   * transaction to undo it.
   *
   * ANY later round counts, fought or not. An all-`scheduled` round N+1 has
   * already been published to the whole field by `notifyRoundPublished` and had
   * pistes assigned by `scheduleRound`, and its pairing was drawn from standings
   * that included the result being undone. "Untouched" is not "inconsequential".
   *
   * The remedy named in the refusal is `DELETE /swiss-phases/:id/rounds/:n`,
   * which `SwissService.deleteRound` accepts for exactly the last round with
   * every bout still scheduled — so an organiser told to redraw can actually do
   * it. Redrawing it HERE would be worse than the problem: it fires a second
   * `swiss_round_published` at fighters already walking to a piste, which
   * `22-swiss.spec.ts` records as the thing not to do.
   */
  async assertUncompletable(matchId: string, opts: SwissUncompleteOptions): Promise<void> {
    if (!this.roundState) return;
    const round = await this.roundOf(matchId);
    if (!round) return;
    if (!(await this.hasLaterRound(round.phaseId, round.roundNumber))) return;

    if (!opts.discardDependents) {
      throw new ConflictException({
        message:
          'A later Swiss round has already been drawn from these standings. ' +
          'Delete that round first, or confirm that it stands as drawn.',
        code: 'swiss_later_round_already_drawn',
        roundNumber: round.roundNumber,
      });
    }
    if (!opts.actor?.canDiscardDependentResults) {
      throw new ForbiddenException({
        message: 'Only an organiser can undo a result once a later Swiss round has been drawn',
        code: 'uncomplete_requires_organiser',
      });
    }
  }

  /**
   * The rounds already drawn after this match's round, for the pre-flight.
   *
   * Deliberately NOT folded into the bracket's `affected` list — that is read as
   * "bouts emptied", and a Swiss round is not a bout. Empty for every non-Swiss
   * match, and for a Swiss match on the frontier round.
   */
  async roundsAhead(matchId: string): Promise<SwissRoundAhead[]> {
    const round = await this.roundOf(matchId);
    if (!round) return [];
    const { data } = await this.supabase.service
      .from('swiss_rounds')
      .select('round_number, status, matches(status, started_at)')
      .eq('phase_id', round.phaseId)
      .gt('round_number', round.roundNumber)
      .order('round_number', { ascending: true });

    return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      roundNumber: row['round_number'] as number,
      status: row['status'] as string,
      // Voided is filtered here rather than in the select, because PostgREST
      // filters on an embedded resource would drop the whole ROUND when none of
      // its matches match — and a round with no fought bout is exactly what this
      // needs to report. Answer-preserving: 'voided' was never in the set.
      hasFoughtBout: (
        (row['matches'] ?? []) as Array<{ status: string; started_at: string | null }>
      )
        .filter((match) => match.status !== 'voided')
        .some((match) => hasBeenFought(match.status, match.started_at ?? null)),
    }));
  }

  /**
   * A match STOPPED being completed, so the round it closed is open again.
   *
   * The whole inverse. `refresh` is already bidirectional — it writes whatever
   * `deriveRoundStatus` says and only when it differs — so the round drops back
   * to `running` or `pending` with no new transition logic. What it needs is the
   * `asIfUnplayed` projection: see `SwissRoundStateService.refresh`.
   *
   * The already-drawn later round is NOT redrawn. `assertUncompletable` has
   * either refused or been acknowledged, and the frontier guard in
   * `onMatchCompleted` stops the re-completion from committing a skipped round
   * on the way back.
   *
   * Swallows, like its sibling: called after the bout has been put back.
   */
  async onMatchUncompleted(matchId: string): Promise<void> {
    if (!this.roundState) return;
    try {
      const round = await this.roundOf(matchId);
      if (!round) return;
      await this.roundState.refresh(round.roundId, matchId);
    } catch (err) {
      this.logger.warn(`swiss round reopen after match ${matchId} failed: ${describe(err)}`);
    }
  }

  private async roundOf(matchId: string): Promise<SwissRoundRef | null> {
    const { data } = await this.supabase.service
      .from('matches')
      .select('swiss_round_id, swiss_rounds(phase_id, round_number)')
      .eq('id', matchId)
      .maybeSingle();
    const row = data as { swiss_round_id?: string | null; swiss_rounds?: unknown } | null;
    if (!row?.swiss_round_id) return null;

    // Many-to-one embeds come back as objects; normalise defensively.
    const embed = Array.isArray(row.swiss_rounds) ? row.swiss_rounds[0] : row.swiss_rounds;
    const round = embed as { phase_id?: string; round_number?: number } | null;
    if (!round?.phase_id || typeof round.round_number !== 'number') return null;
    return {
      roundId: row.swiss_round_id,
      phaseId: round.phase_id,
      roundNumber: round.round_number,
    };
  }

  /**
   * Does this phase already carry a round drawn after this one?
   *
   * A head count, served by `swiss_rounds UNIQUE (phase_id, round_number)`.
   * Asks about the ROUND NUMBER rather than the row count, because the two stop
   * agreeing the moment a round is deleted.
   */
  private async hasLaterRound(phaseId: string, roundNumber: number): Promise<boolean> {
    const { count } = await this.supabase.service
      .from('swiss_rounds')
      .select('id', { count: 'exact', head: true })
      .eq('phase_id', phaseId)
      .gt('round_number', roundNumber);
    return (count ?? 0) > 0;
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

/**
 * What the un-completion owner already knows about who is asking. Structurally
 * the subset of `UncompleteOptions` this service needs — declared here rather
 * than imported so SwissCoreModule keeps no dependency on PhasesModule.
 */
export interface SwissUncompleteOptions {
  actor?: { canDiscardDependentResults?: boolean };
  discardDependents?: boolean;
}

/** One round already drawn after the one being un-completed. */
export interface SwissRoundAhead {
  roundNumber: number;
  status: string;
  hasFoughtBout: boolean;
}

/** The Swiss round a match belongs to, resolved in one read. */
interface SwissRoundRef {
  roundId: string;
  phaseId: string;
  roundNumber: number;
}
