import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { registry } from '@myclash/rulesets';
import type { StandingsColumn, RankingRule } from '@myclash/rulesets';
import { SupabaseService } from '../supabase/supabase.service';
import { normalizeRulesetVersion } from '../events/ruleset-defaults';

export interface StandingsRow {
  rank: number;
  registrationId: string;
  displayName: string;
  club: { id: string; name: string; abbreviation: string | null } | null;
  status: 'in_progress' | 'completed';
  stats: Record<string, number | string>;
}

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
  constructor(private readonly supabase: SupabaseService) {}

  async getPoolStandings(
    tournamentId: string,
    mode: 'by-pool' | 'overall',
  ): Promise<PoolStandingsResponse> {
    // 1. Tournament + ruleset.
    const { data: tournament, error: tournamentError } = await this.supabase.service
      .from('tournaments')
      .select('id, ruleset_code, ruleset_version')
      .eq('id', tournamentId)
      .maybeSingle();
    if (tournamentError) throw new BadRequestException(tournamentError.message);
    if (!tournament) throw new NotFoundException(`Tournament ${tournamentId} not found`);

    const rulesetCode = (tournament as { ruleset_code: string }).ruleset_code;
    const rulesetVersion = (tournament as { ruleset_version: string }).ruleset_version;

    let ruleset;
    try {
      // Normalize the stored version to the registry-canonical form ('1' ->
      // '1.0.0'). Tournaments created before the createTournament fix persisted
      // the raw shorthand, so normalize here to resolve those legacy rows too.
      ruleset = registry.get(rulesetCode, normalizeRulesetVersion(rulesetVersion));
    } catch {
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
    const poolRows = (pools ?? []) as unknown as Array<{
      id: string;
      name: string;
      pool_members: Array<{
        registration_id: string;
        registrations: {
          id: string;
          persons: {
            id: string;
            given_name: string;
            family_name: string;
            clubs: { id: string; name: string; abbreviation: string | null } | null;
          };
        };
      }>;
    }>;

    // 4. Matches in this phase.
    // NOTE: do NOT select a column that doesn't exist on `matches` (there is no
    // `scoring_payload` column). PostgREST fails the whole select on an unknown
    // column, and silently swallowing that error here made every pool look
    // empty → standings all-zero, pools never "completed", bracket never
    // auto-populated. Check the error and throw instead of degrading silently.
    const { data: matches, error: matchesError } = await this.supabase.service
      .from('matches')
      .select(
        'id, pool_id, status, red_registration_id, blue_registration_id, red_score, blue_score',
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
    }>;

    // 5. Per-pool standings.
    const perPool = poolRows.map((pool) => {
      const poolMatches = matchRows.filter((m) => m.pool_id === pool.id);
      const completed = poolMatches.filter((m) => m.status === 'completed');
      const poolStatus: 'in_progress' | 'completed' =
        poolMatches.length > 0 && completed.length === poolMatches.length
          ? 'completed'
          : 'in_progress';
      const rows = this.computeRows(pool, completed, columns, rankingChain, poolStatus);
      return { poolId: pool.id, poolName: pool.name, status: poolStatus, rows };
    });

    if (mode === 'by-pool') {
      return { rulesetCode, rulesetVersion, columns, pools: perPool };
    }

    // 6. Overall: flatten + re-rank globally.
    const allRows = perPool.flatMap((p) => p.rows);
    const ranked = this.applyRanking(allRows, rankingChain);
    return { rulesetCode, rulesetVersion, columns, rows: ranked };
  }

  private computeRows(
    pool: {
      id: string;
      name: string;
      pool_members: Array<{
        registration_id: string;
        registrations: {
          id: string;
          persons: {
            id: string;
            given_name: string;
            family_name: string;
            clubs: { id: string; name: string; abbreviation: string | null } | null;
          };
        };
      }>;
    },
    completedMatches: Array<{
      red_registration_id: string;
      blue_registration_id: string;
      red_score: number | null;
      blue_score: number | null;
    }>,
    columns: StandingsColumn[],
    rankingChain: RankingRule[],
    poolStatus: 'in_progress' | 'completed',
  ): StandingsRow[] {
    const statsByReg = new Map<string, Record<string, number>>();
    for (const member of pool.pool_members) {
      const empty: Record<string, number> = {};
      for (const col of columns) {
        empty[col.key] = 0;
      }
      statsByReg.set(member.registration_id, empty);
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

      // The extended columns doubles / hitsGiven / hitsReceived / F (forfeit)
      // were previously read from a `matches.scoring_payload` column that was
      // never migrated nor written, so they have always resolved to 0. They
      // stay at their initialized 0 here; deriving them properly would mean
      // aggregating the `exchanges` (type='double', hit values), `match_penalties`
      // and `match_forfeits` tables — a follow-up if those columns are needed.
    }

    for (const stats of statsByReg.values()) {
      if ('diff' in stats) {
        stats['diff'] = (stats['ptsScored'] ?? 0) - (stats['ptsConceded'] ?? 0);
      }
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

    return this.applyRanking(rows, rankingChain);
  }

  private applyRanking(rows: StandingsRow[], rankingChain: RankingRule[]): StandingsRow[] {
    const sorted = [...rows].sort((a, b) => {
      for (const rule of rankingChain) {
        const av = Number(a.stats[rule.key] ?? 0);
        const bv = Number(b.stats[rule.key] ?? 0);
        if (av !== bv) {
          return rule.direction === 'desc' ? bv - av : av - bv;
        }
      }
      return 0;
    });
    return sorted.map((row, i) => ({ ...row, rank: i + 1 }));
  }
}
