/**
 * ScoringService — derives match scores from exchanges using @myclash/rulesets.
 *
 * AGENTS.md hard rule #1: scores are ALWAYS derived from exchanges via the
 * ruleset engine. Never store computed scores as the source of truth.
 */
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  registry,
  TF_v1,
  Generic_PointsCap,
  getEffectiveBestOf,
  getEffectiveMaxDoubles,
  getPointCapWinnerRegistrationId,
  isPointCapReached,
  normalizeMatchFormatConfig,
  pointCapWinnerColor,
  roundWinTarget,
} from '@myclash/rulesets';
import type {
  Exchange as RulesetExchange,
  Match as RulesetMatch,
  MatchFormatConfig,
  MatchScore as RulesetMatchScore,
  Ruleset,
} from '@myclash/rulesets';
import { SupabaseService } from '../supabase/supabase.service';
import { RulesetResolver } from './ruleset-resolver.service';
import { ClockService } from './clock.service';

// Register all built-in rulesets on module load
// (idempotent — registry.register throws on duplicate, so we guard)
function registerBuiltins() {
  for (const ruleset of [TF_v1, Generic_PointsCap]) {
    if (!registry.has(ruleset.code, ruleset.version)) {
      registry.register(ruleset);
    }
  }
}
registerBuiltins();

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

@Injectable()
export class ScoringService {
  private readonly logger = new Logger(ScoringService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly rulesets: RulesetResolver,
    private readonly clock: ClockService,
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
      .select('score_delta, registration_id')
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
    // ruleset_config. Attach it onto the config so the engine can net deductive
    // afterblows (the engine reads it off the raw object before its Zod parse).
    const afterblowMode = this.afterblowMode(m['phases']);
    const configWithMode =
      config && typeof config === 'object'
        ? { ...(config as Record<string, unknown>), afterblowMode }
        : { afterblowMode };

    const matchFormat = normalizeMatchFormatConfig(
      (config as { matchFormat?: unknown } | null)?.matchFormat ?? {},
    );
    // Best-of-N (bestOf > 1) runs the round lifecycle instead of the single-fight
    // path below. bestOf = 1 falls through to the exact existing behaviour.
    if (getEffectiveBestOf(match, matchFormat) > 1) {
      return this.recomputeBestOfRounds({
        matchId,
        match,
        ruleset,
        configWithMode,
        matchFormat,
        afterblowMode,
        rawRows,
        penaltyRows: (penaltyRows ?? []) as Record<string, unknown>[],
        matchRow: m,
      });
    }

    const score = ruleset.computeMatchScore(match, exchanges, configWithMode);
    for (const row of penaltyRows ?? []) {
      const penalty = row as Record<string, unknown>;
      const delta = (penalty['score_delta'] as number | null) ?? 0;
      if (penalty['registration_id'] === match.redRegistrationId) score.redScore += delta;
      if (penalty['registration_id'] === match.blueRegistrationId) score.blueScore += delta;
    }

    const matchEndDecision = ruleset.isMatchOver(match, exchanges, 0, configWithMode);
    const winnerRegistrationId =
      matchEndDecision.reason === 'first_to_points'
        ? getPointCapWinnerRegistrationId(match, score, matchFormat)
        : null;
    // True only on the transition INTO completed — the guard makes the
    // side effects below (clock end) fire exactly once.
    const justCompleted = match.status !== 'completed' && matchEndDecision.isOver;
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

    // Persist derived scores back to matches row
    await this.supabase.service.from('matches').update(matchUpdates).eq('id', matchId);

    // The ruleset closed the match (point cap or double cap). Stop the
    // clock so it freezes and the scoreboard's clock-driven endcard fires.
    if (justCompleted) {
      await this.endClockBestEffort(matchId);
    }

    return { redScore: score.redScore, blueScore: score.blueScore };
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
      firstStrikeValue: (e['first_strike_value'] as 1 | 2 | null) ?? null,
      afterblowValue: (e['afterblow_value'] as 1 | 2 | null) ?? null,
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
   * Evaluate the OPEN round from its round-scoped exchanges. Uses the ruleset's
   * own scorer (so per-round scoring matches single-round scoring for every
   * ruleset), then applies the automatic round-end rules: first-to-pointCap, or
   * pool-only max-doubles (a drawn round). Time expiry is operator-driven and
   * handled by endRoundOnTime, never here.
   */
  private evaluateOpenRound(
    ruleset: Ruleset,
    match: RulesetMatch,
    openExchanges: RulesetExchange[],
    configWithMode: Record<string, unknown>,
    matchFormat: MatchFormatConfig,
  ): {
    score: RulesetMatchScore;
    autoOver: boolean;
    winnerColor: 'red' | 'blue' | null;
    endReason: ClosedRound['endReason'];
  } {
    const score = ruleset.computeMatchScore(match, openExchanges, configWithMode);
    if (isPointCapReached(score, matchFormat)) {
      return {
        score,
        autoOver: true,
        winnerColor: pointCapWinnerColor(score, matchFormat),
        endReason: 'first_to_points',
      };
    }
    const effectiveMaxDoubles = getEffectiveMaxDoubles(match, matchFormat);
    if (effectiveMaxDoubles !== null && score.doubles >= effectiveMaxDoubles) {
      return { score, autoOver: true, winnerColor: null, endReason: 'max_doubles' };
    }
    return { score, autoOver: false, winnerColor: null, endReason: null };
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
    configWithMode: Record<string, unknown>;
    matchFormat: MatchFormatConfig;
    afterblowMode: 'full' | 'deductive';
    rawRows: Record<string, unknown>[];
    penaltyRows: Record<string, unknown>[];
    matchRow: Record<string, unknown>;
  }): Promise<{ redScore: number; blueScore: number }> {
    const { matchId, match, ruleset, configWithMode, matchFormat, rawRows, penaltyRows, matchRow } =
      args;
    const winTarget = roundWinTarget(getEffectiveBestOf(match, matchFormat));
    const closedRounds = this.parseRoundsJson(matchRow['rounds_json']);
    const currentRound = (matchRow['current_round'] as number) ?? 1;

    const openExchanges = rawRows
      .filter((r) => ((r['round_number'] as number | null) ?? 1) === currentRound)
      .map((r) => this.mapExchange(r));
    const ev = this.evaluateOpenRound(ruleset, match, openExchanges, configWithMode, matchFormat);

    let openRed = ev.score.redScore;
    let openBlue = ev.score.blueScore;
    for (const row of penaltyRows) {
      const delta = (row['score_delta'] as number | null) ?? 0;
      if (row['registration_id'] === match.redRegistrationId) openRed += delta;
      if (row['registration_id'] === match.blueRegistrationId) openBlue += delta;
    }

    const currentAlreadyClosed = closedRounds.some((r) => r.round === currentRound);
    const updates: Record<string, unknown> = {
      red_score: openRed,
      blue_score: openBlue,
      current_round: currentRound,
      updated_at: new Date().toISOString(),
    };
    let justCompleted = false;

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
      ctx.configWithMode,
      ctx.matchFormat,
    );
    let openRed = ev.score.redScore;
    let openBlue = ev.score.blueScore;
    for (const row of ctx.penaltyRows) {
      const delta = (row['score_delta'] as number | null) ?? 0;
      if (row['registration_id'] === ctx.match.redRegistrationId) openRed += delta;
      if (row['registration_id'] === ctx.match.blueRegistrationId) openBlue += delta;
    }

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
    configWithMode: Record<string, unknown>;
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
      .select('score_delta, registration_id')
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
    const configWithMode =
      config && typeof config === 'object'
        ? { ...(config as Record<string, unknown>), afterblowMode }
        : { afterblowMode };
    const matchFormat = normalizeMatchFormatConfig(
      (config as { matchFormat?: unknown } | null)?.matchFormat ?? {},
    );

    return {
      match,
      matchRow: m,
      ruleset,
      configWithMode,
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
