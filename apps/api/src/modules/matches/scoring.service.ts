/**
 * ScoringService — derives match scores from exchanges using @myclash/rulesets.
 *
 * AGENTS.md hard rule #1: scores are ALWAYS derived from exchanges via the
 * ruleset engine. Never store computed scores as the source of truth.
 */
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
// Value import, not `import type`: Nest needs the runtime class for DI metadata.
import { MatchCompletionService } from '../phases/match-completion.service';
import {
  TF_v1,
  evaluateRound,
  getEffectiveBestOf,
  getPointCapWinnerRegistrationId,
  normalizeMatchFormatConfig,
  roundWinTarget,
} from '@myclash/rulesets';
import type {
  AfterblowMode,
  Exchange as RulesetExchange,
  Match as RulesetMatch,
  MatchFormatConfig,
  MatchScore,
  RoundEvaluation,
  Ruleset,
} from '@myclash/rulesets';
import { SupabaseService } from '../supabase/supabase.service';
import { RulesetResolver } from './ruleset-resolver.service';
import { ClockService } from './clock.service';
import { popLastClosedRoundColumns, reopenedResultColumns } from './reopen-match-columns';

/**
 * A closed round in a best-of-N match, snapshotted into `matches.rounds_json`.
 * A time-ended round's outcome cannot be re-derived from exchanges alone, so the
 * closure (winner + score + reason) is recorded here. The OPEN round's score is
 * still derived live from its round-scoped exchanges; closed rounds are stable
 * until the match is reopened.
 */
export interface ClosedRound {
  round: number;
  redScore: number;
  blueScore: number;
  winnerColor: 'red' | 'blue' | null;
  endReason: 'first_to_points' | 'max_doubles' | 'time_limit' | null;
}

/**
 * The match format a ruleset actually plays under.
 *
 * The doubles ceiling lives on the SHARED match format, so a tournament can
 * carry one whatever its ruleset is — including `Generic_PointsCap`, which has
 * no such rule. Stripping it here means the round lifecycle agrees with the
 * ruleset: `evaluateRound` closes a round on max-doubles from this config, and
 * it is deliberately ruleset-blind, so the gate has to happen before it.
 *
 * `hasMaxDoubles === false` is the only case that strips. An older ruleset that
 * declares nothing keeps the ceiling, which is what every one of them did
 * before the capability existed.
 */
function resolveMatchFormat(config: unknown, ruleset: Ruleset): MatchFormatConfig {
  const matchFormat = normalizeMatchFormatConfig(
    (config as { matchFormat?: unknown } | null)?.matchFormat ?? {},
  );
  if (ruleset.metadata?.hasMaxDoubles === false) {
    return { ...matchFormat, maxDoubleHits: null };
  }
  return matchFormat;
}

@Injectable()
export class ScoringService {
  private readonly logger = new Logger(ScoringService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly rulesets: RulesetResolver,
    private readonly clock: ClockService,
    /**
     * Optional so unit tests and any consumer that wires ScoringService without
     * PhasesModule keep working — same pattern MatchesService uses. In the real
     * app MatchesModule imports PhasesModule, so this always resolves.
     */
    @Optional() private readonly matchCompletion?: MatchCompletionService,
  ) {}

  /**
   * Recompute and persist the match score from all non-voided exchanges.
   * Called after every exchange insert or void.
   *
   * This is the authoritative scoring path — the ruleset engine is the
   * single source of truth.
   */
  async recomputeMatchScore(matchId: string): Promise<{ redScore: number; blueScore: number }> {
    // Fetch match + all non-voided exchanges
    const { data: matchData, error: matchError } = await this.supabase.service
      .from('matches')
      .select(
        'id, red_registration_id, blue_registration_id, ruleset_code, ruleset_version, status, winner_registration_id, match_number_label, current_round, rounds_json, red_round_wins, blue_round_wins, awaiting_round_advance, phases(type, tournaments(ruleset_config, scoring_config_json))',
      )
      .eq('id', matchId)
      .maybeSingle();

    if (matchError || !matchData) {
      this.logger.error(`Cannot recompute score for match ${matchId}: not found`);
      return { redScore: 0, blueScore: 0 };
    }

    const { data: exchangeRows } = await this.supabase.service
      .from('exchanges')
      .select('*')
      .eq('match_id', matchId)
      .eq('voided', false)
      .order('sequence', { ascending: true });

    const { data: penaltyRows } = await this.supabase.service
      .from('match_penalties')
      .select('score_delta, registration_id, round_number')
      .eq('match_id', matchId)
      .eq('voided', false);

    const m = matchData as Record<string, unknown>;

    // Map DB rows to ruleset types
    const match: RulesetMatch = {
      id: m['id'] as string,
      redRegistrationId: m['red_registration_id'] as string,
      blueRegistrationId: m['blue_registration_id'] as string,
      rulesetCode: (m['ruleset_code'] as string) ?? 'TF_v1',
      rulesetVersion: (m['ruleset_version'] as string) ?? '1.0.0',
      status: (m['status'] as RulesetMatch['status']) ?? 'running',
      phaseType: this.phaseType(m['phases']),
      matchNumberLabel: (m['match_number_label'] as string | null) ?? null,
    };

    const rawRows = (exchangeRows ?? []) as Record<string, unknown>[];
    const exchanges: RulesetExchange[] = rawRows.map((e) => this.mapExchange(e));

    // Resolve the ruleset (registry first, then DB-driven FormulaRuleset).
    let ruleset = await this.rulesets.resolve(match.rulesetCode, match.rulesetVersion);
    if (!ruleset) {
      this.logger.warn(
        `Ruleset ${match.rulesetCode}@${match.rulesetVersion} not found, falling back to TF_v1`,
      );
      ruleset = TF_v1;
    }

    const config = this.rulesetConfig(m['phases']);
    // afterblowMode lives in the tournament's scoring_config_json, not in
    // ruleset_config. It used to be spliced ONTO the config object so the engine
    // could dig it back out before its Zod parse; the contract takes it as a
    // required parameter now, so the splice is gone and the config travels as
    // the ruleset authored it.
    const afterblowMode = this.afterblowMode(m['phases']);

    const matchFormat = resolveMatchFormat(config, ruleset);
    // Best-of-N (bestOf > 1) runs the round lifecycle instead of the single-fight
    // path below. bestOf = 1 falls through to the exact existing behaviour.
    if (getEffectiveBestOf(match, matchFormat) > 1) {
      return this.recomputeBestOfRounds({
        matchId,
        match,
        ruleset,
        config,
        matchFormat,
        afterblowMode,
        rawRows,
        penaltyRows: (penaltyRows ?? []) as Record<string, unknown>[],
        matchRow: m,
      });
    }

    // Every card in the bout: a single fight has one round, so there is nothing
    // to filter by — `current_round` never leaves 1.
    const score = this.applyPenaltyDeltas(
      ruleset.computeMatchScore(match, exchanges, afterblowMode, config),
      match,
      (penaltyRows ?? []) as Record<string, unknown>[],
    );

    // AFTER the penalties, so the end decision and the winner read the SAME
    // number — the one the referee is looking at. They used to disagree: the
    // decision was taken on the bare exchanges and the winner on the penalised
    // score, so a penalty that dropped the cap-reacher back below the cap
    // completed the bout with `end_reason: 'first_to_points'` and no winner.
    const matchEndDecision = ruleset.isMatchOver(match, score, config);
    const winnerRegistrationId =
      matchEndDecision.reason === 'first_to_points'
        ? getPointCapWinnerRegistrationId(match, score, matchFormat)
        : null;
    // True only on the transition INTO completed — the guard makes the
    // side effects below (clock end) fire exactly once.
    const justCompleted = match.status !== 'completed' && matchEndDecision.isOver;
    // And the transition back OUT. A penalty can now END a bout, so voiding one
    // has to be able to reopen it — both paths call this method
    // (`PenaltiesService`). Without this the bout would stay completed, holding
    // a winner whose end condition no longer holds, in front of the referee who
    // just voided the penalty.
    const justReopened = match.status === 'completed' && !matchEndDecision.isOver;
    const matchUpdates: Record<string, unknown> = {
      red_score: score.redScore,
      blue_score: score.blueScore,
      updated_at: new Date().toISOString(),
    };
    if (justCompleted) {
      matchUpdates['status'] = 'completed';
      matchUpdates['ended_at'] = new Date().toISOString();
      matchUpdates['winner_registration_id'] = winnerRegistrationId;
      // 'first_to_points' | 'time_limit' | 'max_doubles' — lets the pad +
      // TV distinguish a 0-0 double loss from a genuine tie.
      matchUpdates['end_reason'] = matchEndDecision.reason;
    }

    // The side effects of an un-completion run BEFORE the row write, because
    // `onMatchUncompleted` can REFUSE and there is no transaction to undo a
    // half-applied reopen. Only once it has agreed do the result columns move.
    if (justReopened && (await this.uncompleteBestEffort(matchId))) {
      Object.assign(matchUpdates, reopenedResultColumns());
    }

    // Persist derived scores back to matches row
    await this.supabase.service.from('matches').update(matchUpdates).eq('id', matchId);

    // The ruleset closed the match (point cap or double cap). Stop the
    // clock so it freezes and the scoreboard's clock-driven endcard fires.
    if (justCompleted) {
      await this.endClockBestEffort(matchId);
      // THIS is how a real bracket match ends — the pad never calls
      // PATCH /matches/:id/status, so before this call the only completion paths
      // that ran the side effects were that endpoint (used solely by the e2e
      // specs) and forfeits. A bracket scored on the pad simply never
      // progressed. Awaited rather than fire-and-forget: it runs once per match,
      // on the closing exchange only, and the pad's next read should already see
      // the next slot filled. MatchCompletionService swallows and logs its own
      // errors, so this cannot fail the exchange that triggered it.
      await this.matchCompletion?.onMatchCompleted(matchId);
    }

    return { redScore: score.redScore, blueScore: score.blueScore };
  }

  /**
   * Add a set of cards to a score. The one owner, used by the single-fight path
   * and — through the round scorer — by both best-of round-closing paths.
   *
   * `doubles` is untouched on purpose: a card is not an exchange, so it can
   * never move a bout toward the doubles ceiling.
   */
  private applyPenaltyDeltas(
    score: MatchScore,
    match: RulesetMatch,
    penaltyRows: Record<string, unknown>[],
  ): MatchScore {
    let { redScore, blueScore } = score;
    for (const row of penaltyRows) {
      const delta = (row['score_delta'] as number | null) ?? 0;
      if (row['registration_id'] === match.redRegistrationId) redScore += delta;
      if (row['registration_id'] === match.blueRegistrationId) blueScore += delta;
    }
    return { ...score, redScore, blueScore };
  }

  /**
   * Take a bout back out of `completed` when its end condition stops holding —
   * today, when the penalty that ended it is voided.
   *
   * Best-effort for the same reason `endClockBestEffort` is: the score is
   * already persisted, and `onMatchUncompleted` REFUSES by design when a frozen
   * result, an active forfeit, a Swiss advance or an already-fought dependent
   * bout stands in the way. A refusal must not fail the penalty void that
   * triggered it — unlike `onMatchCompleted`, this one does not swallow its own
   * errors.
   *
   * RETURNS whether the reopen may proceed. Swallowing the refusal is not the
   * same as ignoring it: the caller must not move the result columns when the
   * side effects were refused, or the bracket keeps naming a winner the bout no
   * longer has. That is the half-applied state this ordering exists to prevent.
   *
   * `discardDependents` is deliberately false. If the winner has already fought
   * the next round, this refuses and logs rather than silently taking that
   * later result down with it; undoing a played bout is an operator's decision.
   */
  private async uncompleteBestEffort(matchId: string): Promise<boolean> {
    try {
      await this.matchCompletion?.onMatchUncompleted(matchId, {
        discardDependents: false,
        reason: 'the bout no longer meets its end condition',
      });
      return true;
    } catch (err) {
      this.logger.warn(
        `Match ${matchId} stayed completed though its end condition no longer holds: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return false;
    }
  }

  /**
   * Auto-end the clock when a match completes on its own (point/double cap).
   * Best-effort: the score + status are already persisted, so a clock-end
   * failure must NOT fail the originating exchange. Only ends a clock that
   * is running or halted — the 'end' transition is invalid (throws) from
   * idle (timer never started) or ended (already stopped), so we skip those.
   * Passes canOverrideLocked so a match auto-locked in the same cycle still
   * stops its clock.
   */
  private async endClockBestEffort(matchId: string): Promise<void> {
    try {
      const clock = await this.clock.getClockState(matchId);
      if (clock.status === 'running' || clock.status === 'halted') {
        await this.clock.clockAction(matchId, 'end', 'auto: match complete', {
          canOverrideLocked: true,
        });
      }
    } catch (err) {
      this.logger.warn(
        `Auto clock-end skipped for match ${matchId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  // ── Best-of-N rounds ───────────────────────────────────────────────────────

  /** Map a raw `exchanges` DB row to the ruleset Exchange shape (non-voided). */
  private mapExchange(e: Record<string, unknown>): RulesetExchange {
    return {
      id: e['id'] as string,
      clientUuid: e['client_uuid'] as string,
      matchId: e['match_id'] as string,
      sequence: e['sequence'] as number,
      type: e['type'] as RulesetExchange['type'],
      occurredAt: e['occurred_at'] as string,
      firstStrikerColor: (e['first_striker_color'] as RulesetExchange['firstStrikerColor']) ?? null,
      firstStrikeValue: (e['first_strike_value'] as number | null) ?? null,
      afterblowValue: (e['afterblow_value'] as number | null) ?? null,
      noExchangeReason: (e['no_exchange_reason'] as string | null) ?? null,
      voided: false,
    };
  }

  /** Parse `matches.rounds_json` (the closed-round snapshots) defensively. */
  private parseRoundsJson(value: unknown): ClosedRound[] {
    if (!Array.isArray(value)) return [];
    return value
      .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
      .map((r) => ({
        round: Number(r['round'] ?? 0),
        redScore: Number(r['redScore'] ?? 0),
        blueScore: Number(r['blueScore'] ?? 0),
        winnerColor:
          r['winnerColor'] === 'red' || r['winnerColor'] === 'blue'
            ? (r['winnerColor'] as 'red' | 'blue')
            : null,
        endReason: (r['endReason'] as ClosedRound['endReason']) ?? null,
      }));
  }

  /**
   * Evaluate the OPEN round from its round-scoped exchanges AND its round-scoped
   * cards, scoring it with the RESOLVED ruleset's own scorer so per-round scoring
   * matches single-round scoring for every ruleset. The automatic round-end
   * rules — first-to-pointCap and pool-only max-doubles — live in
   * `evaluateRound`. Time expiry is operator-driven and handled by
   * endRoundOnTime, never here.
   *
   * The cards go INSIDE the scorer, which is what the `RoundScorer` parameter
   * exists for: the caller decides what "this round's score" means. Adding them
   * afterwards is how the round-end decision and the score recorded for that
   * round came to be two different numbers — the split `a81fb0cf` closed for a
   * single fight, on the same argument. A card can now END a round, so the
   * reverse has to hold too; see the reopen in `recomputeBestOfRounds`.
   */
  private evaluateOpenRound(
    ruleset: Ruleset,
    match: RulesetMatch,
    openExchanges: RulesetExchange[],
    afterblowMode: AfterblowMode,
    config: unknown,
    matchFormat: MatchFormatConfig,
    roundPenalties: Record<string, unknown>[],
  ): RoundEvaluation {
    return evaluateRound(match, openExchanges, matchFormat, (m, exchanges) =>
      this.applyPenaltyDeltas(
        ruleset.computeMatchScore(m, exchanges, afterblowMode, config),
        match,
        roundPenalties,
      ),
    );
  }

  /**
   * Build the matches-table updates for closing the current round (whether the
   * series clinches or merely awaits operator advance). Shared by the automatic
   * close (point cap / max-doubles) and the operator's end-on-time close.
   */
  private buildRoundClosure(
    match: RulesetMatch,
    closedRounds: ClosedRound[],
    currentRound: number,
    openRed: number,
    openBlue: number,
    winnerColor: 'red' | 'blue' | null,
    endReason: ClosedRound['endReason'],
    winTarget: number,
    currentStatus: string,
  ): { updates: Record<string, unknown>; justCompleted: boolean } {
    const newClosed: ClosedRound[] = [
      ...closedRounds,
      { round: currentRound, redScore: openRed, blueScore: openBlue, winnerColor, endReason },
    ];
    const redWins = newClosed.filter((r) => r.winnerColor === 'red').length;
    const blueWins = newClosed.filter((r) => r.winnerColor === 'blue').length;
    const updates: Record<string, unknown> = {
      rounds_json: newClosed,
      red_round_wins: redWins,
      blue_round_wins: blueWins,
    };
    let justCompleted = false;
    if (redWins >= winTarget || blueWins >= winTarget) {
      // Series clinched.
      updates['awaiting_round_advance'] = false;
      justCompleted = currentStatus !== 'completed';
      if (justCompleted) {
        const now = new Date().toISOString();
        updates['status'] = 'completed';
        updates['ended_at'] = now;
        updates['winner_registration_id'] =
          redWins >= winTarget ? match.redRegistrationId : match.blueRegistrationId;
        updates['end_reason'] = endReason;
      }
    } else {
      // Round over but not clinched — wait for the operator to start the next.
      updates['awaiting_round_advance'] = true;
    }
    return { updates, justCompleted };
  }

  /**
   * The penalties that belong to one round.
   *
   * A card carries the round it was given in (migration 0191), the way an
   * exchange does. Before that column existed every non-voided card in the bout
   * was added to whichever round was open, so in a BO3 a yellow from round 1
   * kept subtracting in rounds 2 and 3 — while round 1's snapshot in
   * `rounds_json` had already banked it.
   *
   * `?? 1` for the same reason the exchange filter has it: a row written before
   * the column existed reads as round 1, which is where a single-round match's
   * cards belong anyway.
   */
  private penaltiesInRound(
    penaltyRows: Record<string, unknown>[],
    round: number,
  ): Record<string, unknown>[] {
    return penaltyRows.filter((r) => ((r['round_number'] as number | null) ?? 1) === round);
  }

  /**
   * Round-aware recompute for best-of matches: scores the OPEN round, and when
   * that round auto-closes (cap / pool max-doubles) records the closure and
   * either completes the series (⌈bestOf/2⌉ round wins) or flags
   * `awaiting_round_advance`. Closed rounds are stable; only the open round's
   * score is derived live from its exchanges.
   */
  private async recomputeBestOfRounds(args: {
    matchId: string;
    match: RulesetMatch;
    ruleset: Ruleset;
    config: unknown;
    matchFormat: MatchFormatConfig;
    afterblowMode: AfterblowMode;
    rawRows: Record<string, unknown>[];
    penaltyRows: Record<string, unknown>[];
    matchRow: Record<string, unknown>;
  }): Promise<{ redScore: number; blueScore: number }> {
    const {
      matchId,
      match,
      ruleset,
      config,
      afterblowMode,
      matchFormat,
      rawRows,
      penaltyRows,
      matchRow,
    } = args;
    const winTarget = roundWinTarget(getEffectiveBestOf(match, matchFormat));
    const closedRounds = this.parseRoundsJson(matchRow['rounds_json']);
    const currentRound = (matchRow['current_round'] as number) ?? 1;

    const openExchanges = rawRows
      .filter((r) => ((r['round_number'] as number | null) ?? 1) === currentRound)
      .map((r) => this.mapExchange(r));
    const ev = this.evaluateOpenRound(
      ruleset,
      match,
      openExchanges,
      afterblowMode,
      config,
      matchFormat,
      this.penaltiesInRound(penaltyRows, currentRound),
    );

    const openRed = ev.score.redScore;
    const openBlue = ev.score.blueScore;

    const closedCurrent = closedRounds.find((r) => r.round === currentRound);
    const currentAlreadyClosed = closedCurrent !== undefined;
    const updates: Record<string, unknown> = {
      red_score: openRed,
      blue_score: openBlue,
      current_round: currentRound,
      updated_at: new Date().toISOString(),
    };
    let justCompleted = false;

    if (currentAlreadyClosed && this.roundShouldReopen(closedCurrent, ev)) {
      return this.reopenClosedRound({ matchId, match, matchRow, updates, openRed, openBlue });
    }

    if (!currentAlreadyClosed && ev.autoOver) {
      const closure = this.buildRoundClosure(
        match,
        closedRounds,
        currentRound,
        openRed,
        openBlue,
        ev.winnerColor,
        ev.endReason,
        winTarget,
        match.status,
      );
      Object.assign(updates, closure.updates);
      justCompleted = closure.justCompleted;
    } else {
      // Round in progress, or already closed (awaiting advance / completed).
      const redWins = closedRounds.filter((r) => r.winnerColor === 'red').length;
      const blueWins = closedRounds.filter((r) => r.winnerColor === 'blue').length;
      const seriesOver = redWins >= winTarget || blueWins >= winTarget;
      updates['red_round_wins'] = redWins;
      updates['blue_round_wins'] = blueWins;
      updates['awaiting_round_advance'] =
        currentAlreadyClosed && !seriesOver && match.status !== 'completed';
    }

    await this.supabase.service.from('matches').update(updates).eq('id', matchId);
    if (justCompleted) await this.endClockBestEffort(matchId);
    else if (updates['awaiting_round_advance'] === true) await this.haltClockBestEffort(matchId);

    return { redScore: openRed, blueScore: openBlue };
  }

  /**
   * Does a closed round have to be reopened?
   *
   * Only a round the engine closed BY ITSELF, and only while the re-evaluation
   * says its end condition no longer holds — which today means the card that
   * closed it was voided. That is the mirror of a card being able to close a
   * round; shipping the forward half alone installs a one-way door.
   *
   * A round closed on TIME is never reopened. The operator ended it, and
   * `rounds_json` exists precisely because a time-ended round cannot be derived
   * back from its exchanges. A round the series has already advanced PAST is not
   * reachable here either: `current_round` has moved on, so the closed entry
   * this looks for is not the current one.
   */
  private roundShouldReopen(closed: ClosedRound, ev: RoundEvaluation): boolean {
    const closedAutomatically =
      closed.endReason === 'first_to_points' || closed.endReason === 'max_doubles';
    return closedAutomatically && !ev.autoOver;
  }

  /**
   * Put the current round back on the board: pop its snapshot, re-derive the
   * round-win tallies from what is left, and — when the closure had clinched the
   * series — take the bout back out of `completed`.
   *
   * ORDER IS THE WHOLE GUARANTEE, because there is no transaction.
   * `onMatchUncompleted` refuses on a frozen result, an active forfeit, a Swiss
   * advance or a dependent bout already fought, so it runs FIRST and a refusal
   * leaves the round closed and the series standing rather than half of each.
   *
   * The clock stays where the closure left it — halted. Restarting it for the
   * reopened round is the operator's action, as it is after any round close.
   */
  private async reopenClosedRound(args: {
    matchId: string;
    match: RulesetMatch;
    matchRow: Record<string, unknown>;
    updates: Record<string, unknown>;
    openRed: number;
    openBlue: number;
  }): Promise<{ redScore: number; blueScore: number }> {
    const { matchId, match, matchRow, updates, openRed, openBlue } = args;
    const popped = popLastClosedRoundColumns(
      matchRow['rounds_json'],
      (matchRow['current_round'] as number) ?? 1,
    );
    const seriesWasClinched = match.status === 'completed';
    if (popped && (!seriesWasClinched || (await this.uncompleteBestEffort(matchId)))) {
      Object.assign(updates, popped);
      if (seriesWasClinched) Object.assign(updates, reopenedResultColumns());
    }
    await this.supabase.service.from('matches').update(updates).eq('id', matchId);
    return { redScore: openRed, blueScore: openBlue };
  }

  /**
   * Advance a best-of match to the next round: opens it for scoring, resets the
   * clock, and refreshes the (now empty) open-round score. Guards against
   * advancing when no round is awaiting or the match is already completed.
   */
  async advanceRound(
    matchId: string,
    actor?: { userId?: string; staffAccountId?: string; canOverrideLocked?: boolean },
  ): Promise<{ currentRound: number }> {
    const { data: m } = await this.supabase.service
      .from('matches')
      .select('id, status, awaiting_round_advance, current_round')
      .eq('id', matchId)
      .maybeSingle();
    if (!m) throw new NotFoundException(`Match ${matchId} not found`);
    const row = m as Record<string, unknown>;
    if (!row['awaiting_round_advance']) {
      throw new BadRequestException('No round is awaiting advance');
    }
    if (row['status'] === 'completed') {
      throw new BadRequestException('Match is already completed');
    }
    const nextRound = ((row['current_round'] as number) ?? 1) + 1;
    await this.supabase.service
      .from('matches')
      .update({
        current_round: nextRound,
        awaiting_round_advance: false,
        updated_at: new Date().toISOString(),
      })
      .eq('id', matchId);
    await this.appendRoundEvent(matchId, 'round_advance', `advance to round ${nextRound}`, actor);
    await this.resetClockForNewRound(matchId, actor);
    await this.recomputeMatchScore(matchId);
    return { currentRound: nextRound };
  }

  /**
   * Operator ends the current round on time (best-of only). The round winner is
   * whoever leads on score; a tied round is rejected so the operator plays a
   * sudden-death point (decision: time-ties go to sudden death, never a draw).
   */
  async endRoundOnTime(
    matchId: string,
    actor?: { userId?: string; staffAccountId?: string; canOverrideLocked?: boolean },
  ): Promise<{ redScore: number; blueScore: number }> {
    const ctx = await this.loadRoundContext(matchId);
    if (!ctx) throw new NotFoundException(`Match ${matchId} not found`);
    if (getEffectiveBestOf(ctx.match, ctx.matchFormat) <= 1) {
      throw new BadRequestException('Not a best-of match — end the match via the clock');
    }
    if (ctx.match.status === 'completed') {
      throw new BadRequestException('Match is already completed');
    }
    if (ctx.matchRow['awaiting_round_advance']) {
      throw new BadRequestException('Round already ended — advance to the next round');
    }
    const currentRound = (ctx.matchRow['current_round'] as number) ?? 1;
    const closedRounds = this.parseRoundsJson(ctx.matchRow['rounds_json']);
    if (closedRounds.some((r) => r.round === currentRound)) {
      throw new BadRequestException('Round already closed');
    }

    const openExchanges = ctx.rawRows
      .filter((r) => ((r['round_number'] as number | null) ?? 1) === currentRound)
      .map((r) => this.mapExchange(r));
    const ev = this.evaluateOpenRound(
      ctx.ruleset,
      ctx.match,
      openExchanges,
      ctx.afterblowMode,
      ctx.config,
      ctx.matchFormat,
      this.penaltiesInRound(ctx.penaltyRows, currentRound),
    );
    const openRed = ev.score.redScore;
    const openBlue = ev.score.blueScore;

    const winnerColor = openRed > openBlue ? 'red' : openBlue > openRed ? 'blue' : null;
    if (winnerColor === null) {
      throw new BadRequestException('Round is tied — play a sudden-death point to decide it');
    }

    const closure = this.buildRoundClosure(
      ctx.match,
      closedRounds,
      currentRound,
      openRed,
      openBlue,
      winnerColor,
      'time_limit',
      roundWinTarget(getEffectiveBestOf(ctx.match, ctx.matchFormat)),
      ctx.match.status,
    );
    const updates: Record<string, unknown> = {
      ...closure.updates,
      red_score: openRed,
      blue_score: openBlue,
      current_round: currentRound,
      updated_at: new Date().toISOString(),
    };
    await this.supabase.service.from('matches').update(updates).eq('id', matchId);
    await this.appendRoundEvent(matchId, 'round_end', `round ${currentRound} ended on time`, actor);
    if (closure.justCompleted) await this.endClockBestEffort(matchId);
    else await this.haltClockBestEffort(matchId);
    return { redScore: openRed, blueScore: openBlue };
  }

  /** Load the full scoring context (match + exchanges + config) for a match. */
  private async loadRoundContext(matchId: string): Promise<{
    match: RulesetMatch;
    matchRow: Record<string, unknown>;
    ruleset: Ruleset;
    config: unknown;
    afterblowMode: AfterblowMode;
    matchFormat: MatchFormatConfig;
    rawRows: Record<string, unknown>[];
    penaltyRows: Record<string, unknown>[];
  } | null> {
    const { data: matchData } = await this.supabase.service
      .from('matches')
      .select(
        'id, red_registration_id, blue_registration_id, ruleset_code, ruleset_version, status, winner_registration_id, match_number_label, current_round, rounds_json, red_round_wins, blue_round_wins, awaiting_round_advance, phases(type, tournaments(ruleset_config, scoring_config_json))',
      )
      .eq('id', matchId)
      .maybeSingle();
    if (!matchData) return null;
    const m = matchData as Record<string, unknown>;

    const { data: exchangeRows } = await this.supabase.service
      .from('exchanges')
      .select('*')
      .eq('match_id', matchId)
      .eq('voided', false)
      .order('sequence', { ascending: true });
    const { data: penaltyRows } = await this.supabase.service
      .from('match_penalties')
      .select('score_delta, registration_id, round_number')
      .eq('match_id', matchId)
      .eq('voided', false);

    const match: RulesetMatch = {
      id: m['id'] as string,
      redRegistrationId: m['red_registration_id'] as string,
      blueRegistrationId: m['blue_registration_id'] as string,
      rulesetCode: (m['ruleset_code'] as string) ?? 'TF_v1',
      rulesetVersion: (m['ruleset_version'] as string) ?? '1.0.0',
      status: (m['status'] as RulesetMatch['status']) ?? 'running',
      phaseType: this.phaseType(m['phases']),
      matchNumberLabel: (m['match_number_label'] as string | null) ?? null,
    };

    let ruleset = await this.rulesets.resolve(match.rulesetCode, match.rulesetVersion);
    if (!ruleset) ruleset = TF_v1;

    const config = this.rulesetConfig(m['phases']);
    const afterblowMode = this.afterblowMode(m['phases']);
    const matchFormat = resolveMatchFormat(config, ruleset);

    return {
      match,
      matchRow: m,
      ruleset,
      config,
      afterblowMode,
      matchFormat,
      rawRows: (exchangeRows ?? []) as Record<string, unknown>[],
      penaltyRows: (penaltyRows ?? []) as Record<string, unknown>[],
    };
  }

  /** Append a non-clock audit event to the match timeline (best-effort). */
  private async appendRoundEvent(
    matchId: string,
    type: 'round_advance' | 'round_end',
    reason: string,
    actor?: { userId?: string; staffAccountId?: string },
  ): Promise<void> {
    try {
      const { data: lastEvent } = await this.supabase.service
        .from('match_events')
        .select('sequence')
        .eq('match_id', matchId)
        .order('sequence', { ascending: false })
        .limit(1)
        .maybeSingle();
      const sequence = ((lastEvent as { sequence: number } | null)?.sequence ?? 0) + 1;
      await this.supabase.service.from('match_events').insert({
        match_id: matchId,
        sequence,
        type,
        reason,
        by_user_id: actor?.userId ?? null,
        staff_account_id: actor?.staffAccountId ?? null,
        occurred_at: new Date().toISOString(),
      });
    } catch (err) {
      this.logger.warn(
        `Round event '${type}' not logged for match ${matchId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /** Reset the clock to 0 for a new round: halt/reopen as needed, then reset. */
  private async resetClockForNewRound(
    matchId: string,
    actor?: { userId?: string; staffAccountId?: string; canOverrideLocked?: boolean },
  ): Promise<void> {
    try {
      const opts = { ...actor, canOverrideLocked: true };
      const clock = await this.clock.getClockState(matchId);
      if (clock.status === 'running') {
        await this.clock.clockAction(matchId, 'halt', 'round advance', opts);
      } else if (clock.status === 'ended') {
        await this.clock.clockAction(matchId, 'reopen', 'round advance', opts);
      }
      const after = await this.clock.getClockState(matchId);
      if (after.status === 'halted') {
        await this.clock.clockAction(matchId, 'reset_clock', 'next round', opts);
      }
    } catch (err) {
      this.logger.warn(
        `Clock reset skipped for match ${matchId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /** Halt a running clock when a round closes but the series isn't decided. */
  private async haltClockBestEffort(matchId: string): Promise<void> {
    try {
      const clock = await this.clock.getClockState(matchId);
      if (clock.status === 'running') {
        await this.clock.clockAction(matchId, 'halt', 'auto: round over', {
          canOverrideLocked: true,
        });
      }
    } catch (err) {
      this.logger.warn(
        `Clock halt skipped for match ${matchId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  private phaseType(value: unknown): RulesetMatch['phaseType'] {
    const phase = Array.isArray(value) ? value[0] : value;
    const type = (phase as { type?: unknown } | null)?.type;
    return type === 'pool' || type === 'single_elim' || type === 'double_elim' || type === 'swiss'
      ? type
      : undefined;
  }

  private rulesetConfig(value: unknown): unknown {
    const phase = Array.isArray(value) ? value[0] : value;
    const tournaments = (phase as { tournaments?: unknown } | null)?.tournaments;
    const tournament = Array.isArray(tournaments) ? tournaments[0] : tournaments;
    return (tournament as { ruleset_config?: unknown } | null)?.ruleset_config ?? {};
  }

  /**
   * The tournament's afterblow mode, read from scoring_config_json (defaults to
   * 'full'). Drives deductive netting in the score engine.
   */
  private afterblowMode(value: unknown): 'full' | 'deductive' {
    const phase = Array.isArray(value) ? value[0] : value;
    const tournaments = (phase as { tournaments?: unknown } | null)?.tournaments;
    const tournament = Array.isArray(tournaments) ? tournaments[0] : tournaments;
    const scoringConfig = (tournament as { scoring_config_json?: unknown } | null)
      ?.scoring_config_json;
    return (scoringConfig as { afterblowMode?: unknown } | null)?.afterblowMode === 'deductive'
      ? 'deductive'
      : 'full';
  }
}
