/**
 * ScoringService — derives match scores from exchanges using @myclash/rulesets.
 *
 * AGENTS.md hard rule #1: scores are ALWAYS derived from exchanges via the
 * ruleset engine. Never store computed scores as the source of truth.
 */
import { Injectable, Logger } from '@nestjs/common';
import { registry, TF_v1, TF_v1_no_afterblow, Generic_PointsCap } from '@myclash/rulesets';
import type { Exchange as RulesetExchange, Match as RulesetMatch } from '@myclash/rulesets';
import { SupabaseService } from '../supabase/supabase.service';

// Register all built-in rulesets on module load
// (idempotent — registry.register throws on duplicate, so we guard)
function registerBuiltins() {
  for (const ruleset of [TF_v1, TF_v1_no_afterblow, Generic_PointsCap]) {
    if (!registry.has(ruleset.code, ruleset.version)) {
      registry.register(ruleset);
    }
  }
}
registerBuiltins();

@Injectable()
export class ScoringService {
  private readonly logger = new Logger(ScoringService.name);

  constructor(private readonly supabase: SupabaseService) {}

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
      .select('id, red_registration_id, blue_registration_id, ruleset_code, ruleset_version, ruleset_config, status, winner_registration_id')
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

    const m = matchData as Record<string, unknown>;

    // Map DB rows to ruleset types
    const match: RulesetMatch = {
      id: m['id'] as string,
      redRegistrationId: m['red_registration_id'] as string,
      blueRegistrationId: m['blue_registration_id'] as string,
      rulesetCode: (m['ruleset_code'] as string) ?? 'TF_v1',
      rulesetVersion: (m['ruleset_version'] as string) ?? '1.0.0',
      status: (m['status'] as RulesetMatch['status']) ?? 'running',
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
        firstStrikerColor: (ex['first_striker_color'] as RulesetExchange['firstStrikerColor']) ?? null,
        firstStrikeValue: (ex['first_strike_value'] as 1 | 2 | null) ?? null,
        afterblowValue: (ex['afterblow_value'] as 1 | 2 | null) ?? null,
        noExchangeReason: (ex['no_exchange_reason'] as string | null) ?? null,
        voided: false,
      };
    });

    // Get the ruleset from registry
    let ruleset;
    try {
      ruleset = registry.get(match.rulesetCode, match.rulesetVersion);
    } catch {
      // Fallback to TF_v1 if ruleset not found
      this.logger.warn(`Ruleset ${match.rulesetCode}@${match.rulesetVersion} not found, falling back to TF_v1`);
      ruleset = TF_v1;
    }

    const config = m['ruleset_config'] ?? {};
    const score = ruleset.computeMatchScore(match, exchanges, config);

    // Persist derived scores back to matches row
    await this.supabase.service
      .from('matches')
      .update({
        red_score: score.redScore,
        blue_score: score.blueScore,
        updated_at: new Date().toISOString(),
      })
      .eq('id', matchId);

    return { redScore: score.redScore, blueScore: score.blueScore };
  }
}
