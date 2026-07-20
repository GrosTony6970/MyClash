import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { computeAggregates } from '@myclash/rulesets';
import type {
  StandingsColumn,
  RankingRule,
  Exchange,
  Match,
  FighterAggregates,
  Ruleset,
} from '@myclash/rulesets';
import { poolScoresByRegistration } from './ruleset-scores';
import { applyRanking, type PoolWithMembers, type StandingsRow } from './standings-rows';
import { SupabaseService } from '../supabase/supabase.service';
// Value import ON PURPOSE — `import type` erases the DI metadata Nest needs to
// resolve the provider (see modules/matches/di-wiring.regression.test.ts).
import { RulesetResolver } from '../matches/ruleset-resolver.service';
import { normalizeRulesetVersion } from '../events/ruleset-defaults';

// Re-exported so existing consumers keep importing StandingsRow from here.
export type { StandingsRow } from './standings-rows';

export type PoolStandingsResponse =
  | {
      rulesetCode: string;
      rulesetVersion: string;
      columns: StandingsColumn[];
      rows: StandingsRow[];
    }
  | {
      rulesetCode: string;
      rulesetVersion: string;
      columns: StandingsColumn[];
      pools: Array<{
        poolId: string;
        poolName: string;
        status: 'in_progress' | 'completed';
        rows: StandingsRow[];
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
      .select('id, ruleset_code, ruleset_version, ruleset_config, scoring_config_json')
      .eq('id', tournamentId)
      .maybeSingle();
    if (tournamentError) throw new BadRequestException(tournamentError.message);
    if (!tournament) throw new NotFoundException(`Tournament ${tournamentId} not found`);

    const rulesetCode = (tournament as { ruleset_code: string }).ruleset_code;
    const rulesetVersion = (tournament as { ruleset_version: string }).ruleset_version;
    // afterblow netting for the score formula (deductive subtracts the
    // afterblow from the attacker). Lives in scoring_config_json, defaults full.
    const afterblowMode: 'full' | 'deductive' =
      (tournament as { scoring_config_json?: { afterblowMode?: unknown } | null })
        ?.scoring_config_json?.afterblowMode === 'deductive'
        ? 'deductive'
        : 'full';
    // The engine reads afterblowMode off the raw config object even though it
    // is stored in scoring_config_json rather than ruleset_config, so splice it
    // on — the same shape ScoringService hands the engine.
    const runtimeConfig = {
      ...((tournament as { ruleset_config?: Record<string, unknown> | null }).ruleset_config ?? {}),
      afterblowMode,
    };

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
        ? { rulesetCode, rulesetVersion, columns, rows: [] }
        : { rulesetCode, rulesetVersion, columns, pools: [] };
    }

    // 3. Pools + members.
    const { data: pools } = await this.supabase.service
      .from('pools')
      .select(
        // `persons` has no `display_name` column — that lives on
        // `global_persons`. Compose the visible name from given+family
        // in computeRows below.
        'id, name, pool_members(registration_id, registrations(id, persons(id, given_name, family_name, clubs(id, name, abbreviation))))',
      )
      .eq('phase_id', phaseId)
      .order('sort_order', { ascending: true });
    const poolRows = (pools ?? []) as unknown as PoolWithMembers[];

    // 4. Matches in this phase.
    // NOTE: do NOT select a column that doesn't exist on `matches` (there is no
    // `scoring_payload` column). PostgREST fails the whole select on an unknown
    // column, and silently swallowing that error here made every pool look
    // empty → standings all-zero, pools never "completed", bracket never
    // auto-populated. Check the error and throw instead of degrading silently.
    const { data: matches, error: matchesError } = await this.supabase.service
      .from('matches')
      .select(
        'id, pool_id, status, red_registration_id, blue_registration_id, red_score, blue_score, winner_registration_id',
      )
      .eq('phase_id', phaseId);
    if (matchesError) throw new BadRequestException(matchesError.message);
    const matchRows = (matches ?? []) as Array<{
      id: string;
      pool_id: string;
      status: string;
      red_registration_id: string;
      blue_registration_id: string;
      red_score: number | null;
      blue_score: number | null;
      winner_registration_id: string | null;
    }>;

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
        .select('forfeiting_registration_id, match_id')
        .in('match_id', completedMatchIds)
        .is('voided_at', null);
      if (ffErr) throw new BadRequestException(ffErr.message);
      for (const r of (ffRows ?? []) as Array<{ forfeiting_registration_id: string }>) {
        forfeitCountByReg.set(
          r.forfeiting_registration_id,
          (forfeitCountByReg.get(r.forfeiting_registration_id) ?? 0) + 1,
        );
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
      );
      return { poolId: pool.id, poolName: pool.name, status: poolStatus, rows };
    });

    if (mode === 'by-pool') {
      return { rulesetCode, rulesetVersion, columns, pools: perPool };
    }

    // 6. Overall: flatten + re-rank globally.
    const allRows = perPool.flatMap((p) => p.rows);
    const ranked = applyRanking(allRows, rankingChain);
    return { rulesetCode, rulesetVersion, columns, rows: ranked };
  }

  private computeRows(
    pool: PoolWithMembers,
    completedMatches: Array<{
      id: string;
      red_registration_id: string;
      blue_registration_id: string;
      red_score: number | null;
      blue_score: number | null;
      winner_registration_id: string | null;
    }>,
    columns: StandingsColumn[],
    rankingChain: RankingRule[],
    poolStatus: 'in_progress' | 'completed',
    exchangesByMatch: Map<string, Exchange[]>,
    forfeitCountByReg: Map<string, number>,
    ruleset: Ruleset,
    runtimeConfig: unknown,
    afterblowMode: 'full' | 'deductive' = 'full',
  ): StandingsRow[] {
    const statsByReg = new Map<string, Record<string, number>>();
    const declaresScore = columns.some((col) => col.key === 'score');
    // Per-fighter exchange aggregates (targetPoints/timesHit/doubles/wins),
    // accumulated across the pool, and the source of the generic stat columns.
    const aggByReg = new Map<string, FighterAggregates>();
    for (const member of pool.pool_members) {
      const empty: Record<string, number> = {};
      for (const col of columns) {
        empty[col.key] = 0;
      }
      statsByReg.set(member.registration_id, empty);
      aggByReg.set(member.registration_id, { wins: 0, targetPoints: 0, timesHit: 0, doubles: 0 });
    }

    for (const m of completedMatches) {
      const red = statsByReg.get(m.red_registration_id);
      const blue = statsByReg.get(m.blue_registration_id);
      if (!red || !blue) continue;
      const rs = m.red_score ?? 0;
      const bs = m.blue_score ?? 0;

      red['ptsScored'] = (red['ptsScored'] ?? 0) + rs;
      red['ptsConceded'] = (red['ptsConceded'] ?? 0) + bs;
      blue['ptsScored'] = (blue['ptsScored'] ?? 0) + bs;
      blue['ptsConceded'] = (blue['ptsConceded'] ?? 0) + rs;

      if (rs > bs) {
        red['W'] = (red['W'] ?? 0) + 1;
        blue['L'] = (blue['L'] ?? 0) + 1;
      } else if (bs > rs) {
        blue['W'] = (blue['W'] ?? 0) + 1;
        red['L'] = (red['L'] ?? 0) + 1;
      } else {
        red['D'] = (red['D'] ?? 0) + 1;
        blue['D'] = (blue['D'] ?? 0) + 1;
      }

      // Accumulate the canonical per-fighter aggregates from this match's
      // exchanges (hits given/received, doubles) + the win count the score
      // formula needs. computeAggregates only reads redRegistrationId +
      // exchange fields, so a minimal Match cast is enough.
      const matchExchanges = exchangesByMatch.get(m.id) ?? [];
      const rulesetMatch = {
        redRegistrationId: m.red_registration_id,
        blueRegistrationId: m.blue_registration_id,
      } as unknown as Match;
      for (const regId of [m.red_registration_id, m.blue_registration_id]) {
        const acc = aggByReg.get(regId);
        if (!acc) continue;
        const a = computeAggregates(
          regId,
          rulesetMatch,
          matchExchanges,
          m.winner_registration_id === regId,
          afterblowMode,
        );
        acc.wins += a.wins;
        acc.targetPoints += a.targetPoints;
        acc.timesHit += a.timesHit;
        acc.doubles += a.doubles;
      }
    }

    for (const stats of statsByReg.values()) {
      if ('diff' in stats) {
        stats['diff'] = (stats['ptsScored'] ?? 0) - (stats['ptsConceded'] ?? 0);
      }
    }

    // `score` is the one ruleset-SPECIFIC column, so the ruleset computes it.
    // This used to call TF_v1's computeScore directly, which meant an
    // org-authored pool was scored and ranked by the federal formula instead of
    // the author's own scoreFormula.
    const scoreByReg = declaresScore
      ? poolScoresByRegistration(
          ruleset,
          pool.pool_members,
          completedMatches,
          exchangesByMatch,
          runtimeConfig,
        )
      : new Map<string, number>();

    // Extended columns derived from exchanges + forfeits. Only assign keys the
    // active ruleset actually declares (Generic_PointsCap declares none of these
    // and stays untouched). Score is rounded to 2 decimals for display; ranking
    // uses the same rounded value with the ruleset's own tiebreaks after it.
    for (const [regId, stats] of statsByReg) {
      const agg = aggByReg.get(regId) ?? { wins: 0, targetPoints: 0, timesHit: 0, doubles: 0 };
      if ('hitsGiven' in stats) stats['hitsGiven'] = agg.targetPoints;
      if ('hitsReceived' in stats) stats['hitsReceived'] = agg.timesHit;
      if ('doubles' in stats) stats['doubles'] = agg.doubles;
      if ('score' in stats) stats['score'] = Math.round((scoreByReg.get(regId) ?? 0) * 100) / 100;
      if ('F' in stats) stats['F'] = forfeitCountByReg.get(regId) ?? 0;
    }

    const rows: StandingsRow[] = pool.pool_members.map((member) => {
      const person = member.registrations.persons;
      const displayName = `${person.given_name} ${person.family_name}`.trim();
      return {
        rank: 0,
        registrationId: member.registration_id,
        displayName,
        club: person.clubs,
        status: poolStatus,
        stats: statsByReg.get(member.registration_id) ?? {},
      };
    });

    return applyRanking(rows, rankingChain);
  }
}
