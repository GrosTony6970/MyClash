import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { FORFEIT_REASONS } from '@myclash/rulesets';
import type { StandingsColumn, RankingRule, Exchange, Ruleset } from '@myclash/rulesets';
import { afterblowModeInForce } from '@myclash/types';
import type { PoolStandingsRow } from '@myclash/types/pool-standings';
import { computeStandingsRows } from './compute-rows';
import { applyRanking, type StandingsRow } from '@myclash/rules/results';
import { sideKey } from '@myclash/types/side-key';
import { withSideOf, type CompletedBout, type PoolWithMembers } from './pool-rows';
import { SupabaseService } from '../supabase/supabase.service';
// Value import ON PURPOSE — `import type` erases the DI metadata Nest needs to
// resolve the provider (see modules/matches/di-wiring.regression.test.ts).
import { RulesetResolver } from '../matches/ruleset-resolver.service';
import { normalizeRulesetVersion } from '../events/ruleset-defaults';

// Re-exported so existing consumers keep importing StandingsRow from here.
export type { StandingsRow } from '@myclash/rules/results';

/**
 * The ruleset context a fighter page needs to EXPLAIN a placing, projected onto
 * the public standings payload (which otherwise carries only a raw code). The
 * per-column labels for a deciding tiebreak already live in `columns`; this adds
 * the human ruleset name and the score formula's display string. A formula
 * ruleset renders its AST into that string, and TF_v1 ships a static one, so
 * `scoreFormula` is null only for a coded ruleset with no formula (e.g.
 * Generic_PointsCap).
 */
export interface RulesetDerivationMeta {
  label: string;
  scoreFormula: string | null;
  /** Short prefix of the tournament's effective (scoring, penalty) content hash
   *  — a verifiable identity token supplementing the human label. Null until the
   *  tournament has been stamped. */
  contentFingerprint: string | null;
}

export type PoolStandingsResponse =
  | {
      rulesetCode: string;
      rulesetVersion: string;
      ruleset: RulesetDerivationMeta;
      columns: StandingsColumn[];
      rows: PoolStandingsRow[];
    }
  | {
      rulesetCode: string;
      rulesetVersion: string;
      ruleset: RulesetDerivationMeta;
      columns: StandingsColumn[];
      pools: Array<{
        poolId: string;
        poolName: string;
        status: 'in_progress' | 'completed';
        rows: PoolStandingsRow[];
      }>;
    };

@Injectable()
export class PoolStandingsService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly rulesets: RulesetResolver,
  ) {}

  async getPoolStandings(
    tournamentId: string,
    mode: 'by-pool' | 'overall',
  ): Promise<PoolStandingsResponse> {
    // 1. Tournament + ruleset.
    const { data: tournament, error: tournamentError } = await this.supabase.service
      .from('tournaments')
      .select(
        'id, ruleset_code, ruleset_version, ruleset_config, scoring_config_json, ruleset_content_hash',
      )
      .eq('id', tournamentId)
      .maybeSingle();
    if (tournamentError) throw new BadRequestException(tournamentError.message);
    if (!tournament) throw new NotFoundException(`Tournament ${tournamentId} not found`);

    const rulesetCode = (tournament as { ruleset_code: string }).ruleset_code;
    const rulesetVersion = (tournament as { ruleset_version: string }).ruleset_version;
    // afterblow netting for the score formula (deductive subtracts the
    // afterblow from the attacker). Lives in scoring_config_json, defaults full.
    const afterblowMode = afterblowModeInForce(
      (tournament as { scoring_config_json?: unknown }).scoring_config_json,
    );
    // The engine reads afterblowMode off the raw config object even though it
    // is stored in scoring_config_json rather than ruleset_config, so splice it
    // on — the same shape ScoringService hands the engine.
    const rulesetConfig =
      (tournament as { ruleset_config?: Record<string, unknown> | null }).ruleset_config ?? {};
    const runtimeConfig = { ...rulesetConfig, afterblowMode };

    // Resolve through RulesetResolver rather than the in-memory registry. The
    // registry only ever holds the built-ins (TF_v1, Generic_PointsCap), so an
    // org-authored custom ruleset 400'd here — standings were the one surface
    // that could not see it, even though scoring resolved it fine.
    //
    // normalizeRulesetVersion STAYS. Tournaments created before the
    // createTournament fix persisted the raw '1' shorthand, and the resolver's
    // registry short-circuit (what keeps TF_v1 working) is keyed on '1.0.0';
    // is_system rows are deliberately never resolvable via the DB path.
    const ruleset = await this.rulesets.resolve(
      rulesetCode,
      normalizeRulesetVersion(rulesetVersion),
    );
    if (!ruleset) {
      throw new BadRequestException(`Ruleset ${rulesetCode} v${rulesetVersion} not registered`);
    }

    const columns = ruleset.standingsColumns;
    const rankingChain = ruleset.rankingChain;
    const contentHash =
      (tournament as { ruleset_content_hash?: string | null }).ruleset_content_hash ?? null;
    const rulesetMeta: RulesetDerivationMeta = {
      label: ruleset.displayName,
      scoreFormula: ruleset.metadata?.scoreFormula ?? null,
      contentFingerprint: contentHash ? contentHash.slice(0, 12) : null,
    };

    // 2. Pool phase for this tournament.
    const { data: phase } = await this.supabase.service
      .from('phases')
      .select('id')
      .eq('tournament_id', tournamentId)
      .eq('type', 'pool')
      .maybeSingle();
    const phaseId = (phase as { id?: string } | null)?.id;
    if (!phaseId) {
      return mode === 'overall'
        ? { rulesetCode, rulesetVersion, ruleset: rulesetMeta, columns, rows: [] }
        : { rulesetCode, rulesetVersion, ruleset: rulesetMeta, columns, pools: [] };
    }

    // 3. Pools + members.
    const { data: pools } = await this.supabase.service
      .from('pools')
      .select(
        // `persons` has no `display_name` column — that lives on
        // `global_persons`. Compose the visible name from given+family
        // in computeRows below.
        // A seat holds a Registration or a team (0282).
        'id, name, pool_members(registration_id, team_id, registrations(id, persons(id, given_name, family_name, clubs(id, name, abbreviation))), teams(id, name, color, logo_url))',
      )
      .eq('phase_id', phaseId)
      .order('sort_order', { ascending: true });
    const poolRows = (pools ?? []) as unknown as PoolWithMembers[];
    const withSide = withSideOf(poolRows);

    // 4. Matches in this phase.
    // NOTE: do NOT select a column that doesn't exist on `matches` (there is no
    // `scoring_payload` column). PostgREST fails the whole select on an unknown
    // column, and silently swallowing that error here made every pool look
    // empty → standings all-zero, pools never "completed", bracket never
    // auto-populated. Check the error and throw instead of degrading silently.
    const { data: matches, error: matchesError } = await this.supabase.service
      .from('matches')
      .select(
        'id, pool_id, status, red_registration_id, blue_registration_id, red_team_id, blue_team_id, red_score, blue_score, winner_registration_id, winner_team_id, end_reason',
      )
      .eq('phase_id', phaseId);
    if (matchesError) throw new BadRequestException(matchesError.message);
    const matchRows = (matches ?? []) as Array<CompletedBout & { pool_id: string; status: string }>;

    // 4b. Exchanges + forfeits for completed matches — the source for the
    // ruleset's score formula and the hits/doubles/forfeit columns. The
    // pre-removal code read these from a non-existent `scoring_payload` column,
    // which is why those columns showed 0. We now derive them from the
    // `exchanges` table via the canonical computeAggregates/computeScore.
    const completedMatchIds = matchRows.filter((m) => m.status === 'completed').map((m) => m.id);
    const exchangesByMatch = new Map<string, Exchange[]>();
    const forfeitCountByReg = new Map<string, number>();
    if (completedMatchIds.length > 0) {
      const { data: exRows, error: exErr } = await this.supabase.service
        .from('exchanges')
        .select('match_id, type, first_striker_color, first_strike_value, afterblow_value, voided')
        .in('match_id', completedMatchIds)
        .eq('voided', false);
      if (exErr) throw new BadRequestException(exErr.message);
      for (const r of (exRows ?? []) as Array<{
        match_id: string;
        type: string;
        first_striker_color: string | null;
        first_strike_value: number | null;
        afterblow_value: number | null;
        voided: boolean;
      }>) {
        // computeAggregates only reads type/firstStrikerColor/firstStrikeValue/
        // afterblowValue/voided — build a minimal Exchange and cast.
        const ex = {
          type: r.type,
          firstStrikerColor: r.first_striker_color,
          firstStrikeValue: r.first_strike_value,
          afterblowValue: r.afterblow_value,
          voided: r.voided,
        } as unknown as Exchange;
        const list = exchangesByMatch.get(r.match_id);
        if (list) list.push(ex);
        else exchangesByMatch.set(r.match_id, [ex]);
      }

      const { data: ffRows, error: ffErr } = await this.supabase.service
        .from('match_forfeits')
        .select('forfeiting_registration_id, forfeiting_team_id')
        .in('match_id', completedMatchIds)
        // match_forfeits also holds result OVERRIDES, which are not forfeits:
        // counting one would deduct an F from a fighter whose result was
        // merely corrected.
        .in('reason', FORFEIT_REASONS)
        .is('voided_at', null);
      if (ffErr) throw new BadRequestException(ffErr.message);
      for (const r of (ffRows ?? []) as Array<{
        forfeiting_registration_id: string | null;
        forfeiting_team_id: string | null;
      }>) {
        // The side that forfeited: a Registration or a team, exactly one
        // (`match_forfeits_forfeiting_one_kind`, 0282).
        const side = sideKey(r.forfeiting_registration_id, r.forfeiting_team_id);
        if (side === null) throw new Error('A forfeit names neither a Registration nor a team');
        forfeitCountByReg.set(side, (forfeitCountByReg.get(side) ?? 0) + 1);
      }
    }

    // 5. Per-pool standings.
    const perPool = poolRows.map((pool) => {
      const poolMatches = matchRows.filter((m) => m.pool_id === pool.id);
      const completed = poolMatches.filter((m) => m.status === 'completed');
      const poolStatus: 'in_progress' | 'completed' =
        poolMatches.length > 0 && completed.length === poolMatches.length
          ? 'completed'
          : 'in_progress';
      const rows = this.computeRows(
        pool,
        completed,
        columns,
        rankingChain,
        poolStatus,
        exchangesByMatch,
        forfeitCountByReg,
        ruleset,
        runtimeConfig,
        afterblowMode,
      ).map(withSide);
      return { poolId: pool.id, poolName: pool.name, status: poolStatus, rows };
    });

    if (mode === 'by-pool') {
      return { rulesetCode, rulesetVersion, ruleset: rulesetMeta, columns, pools: perPool };
    }

    // 6. Overall: flatten + re-rank globally.
    const allRows = perPool.flatMap((p) => p.rows);
    const ranked = applyRanking(allRows, rankingChain).map(withSide);
    return { rulesetCode, rulesetVersion, ruleset: rulesetMeta, columns, rows: ranked };
  }

  private computeRows(
    pool: PoolWithMembers,
    completedMatches: CompletedBout[],
    columns: StandingsColumn[],
    rankingChain: RankingRule[],
    poolStatus: 'in_progress' | 'completed',
    exchangesByMatch: Map<string, Exchange[]>,
    forfeitCountByReg: Map<string, number>,
    ruleset: Ruleset,
    runtimeConfig: unknown,
    afterblowMode: 'full' | 'deductive' = 'full',
  ): StandingsRow[] {
    // The body lives in compute-rows.ts so the Swiss standings can reuse it.
    // `forceScore` is deliberately NOT set: the pool path calls the ruleset for
    // a score only when the columns declare one, and keeping that guard here is
    // what makes this move behaviour-identical.
    return computeStandingsRows({
      members: pool.pool_members,
      completedMatches,
      columns,
      rankingChain,
      status: poolStatus,
      exchangesByMatch,
      forfeitCountByReg,
      ruleset,
      runtimeConfig,
      afterblowMode,
    });
  }
}
