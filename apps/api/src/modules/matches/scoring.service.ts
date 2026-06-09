/**
 * ScoringService — derives match scores from exchanges using @myclash/rulesets.
 *
 * AGENTS.md hard rule #1: scores are ALWAYS derived from exchanges via the
 * ruleset engine. Never store computed scores as the source of truth.
 */
import { Injectable, Logger } from '@nestjs/common';
import {
  registry,
  TF_v1,
  Generic_PointsCap,
  getPointCapWinnerRegistrationId,
  normalizeMatchFormatConfig,
} from '@myclash/rulesets';
import type { Exchange as RulesetExchange, Match as RulesetMatch } from '@myclash/rulesets';
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
        'id, red_registration_id, blue_registration_id, ruleset_code, ruleset_version, status, winner_registration_id, match_number_label, phases(type, tournaments(ruleset_config))',
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

    const exchanges: RulesetExchange[] = (exchangeRows ?? []).map((e) => {
      const ex = e as Record<string, unknown>;
      return {
        id: ex['id'] as string,
        clientUuid: ex['client_uuid'] as string,
        matchId: ex['match_id'] as string,
        sequence: ex['sequence'] as number,
        type: ex['type'] as RulesetExchange['type'],
        occurredAt: ex['occurred_at'] as string,
        firstStrikerColor:
          (ex['first_striker_color'] as RulesetExchange['firstStrikerColor']) ?? null,
        firstStrikeValue: (ex['first_strike_value'] as 1 | 2 | null) ?? null,
        afterblowValue: (ex['afterblow_value'] as 1 | 2 | null) ?? null,
        noExchangeReason: (ex['no_exchange_reason'] as string | null) ?? null,
        voided: false,
      };
    });

    // Resolve the ruleset (registry first, then DB-driven FormulaRuleset).
    let ruleset = await this.rulesets.resolve(match.rulesetCode, match.rulesetVersion);
    if (!ruleset) {
      this.logger.warn(
        `Ruleset ${match.rulesetCode}@${match.rulesetVersion} not found, falling back to TF_v1`,
      );
      ruleset = TF_v1;
    }

    const config = this.rulesetConfig(m['phases']);
    const score = ruleset.computeMatchScore(match, exchanges, config);
    for (const row of penaltyRows ?? []) {
      const penalty = row as Record<string, unknown>;
      const delta = (penalty['score_delta'] as number | null) ?? 0;
      if (penalty['registration_id'] === match.redRegistrationId) score.redScore += delta;
      if (penalty['registration_id'] === match.blueRegistrationId) score.blueScore += delta;
    }

    const matchEndDecision = ruleset.isMatchOver(match, exchanges, 0, config);
    const matchFormat = normalizeMatchFormatConfig(
      (config as { matchFormat?: unknown } | null)?.matchFormat ?? {},
    );
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
}
