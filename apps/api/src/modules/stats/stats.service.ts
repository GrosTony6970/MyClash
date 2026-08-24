/**
 * stats.service.ts — T-1001 + T-1002
 *
 * Per-fighter exchange stats + tournament overview, computed on-read via the
 * fighter_exchange_stats(tournament_id) Postgres function (migration 0128). The
 * former mv_fighter_exchange_stats materialized view was dropped because its
 * refresh trigger only pg_notify'd a channel nobody listened on, so it served
 * stale data. On-read is always fresh and nets afterblow points correctly.
 */

import { Injectable } from '@nestjs/common';
import { normalizeRulesetVersion } from '../events/ruleset-row-projection';
import { SupabaseService } from '../supabase/supabase.service';
import {
  aggregateTargetValues,
  type TargetValueRow,
  type TargetValueStats,
} from './target-value-stats';
// Value import, not `import type`: Nest needs the runtime class for DI metadata.
import { RulesetResolver } from '../matches/ruleset-resolver.service';

/** One point value, and this fighter's four blow counts at it. */
export interface FighterBlowValueCounts {
  /** The target's worth: `exchanges.first_strike_value`. 1 to 10. */
  value: number;
  hitsGiven: number;
  afterblowGiven: number;
  hitsReceived: number;
  afterblowReceived: number;
}

/** One row of `fighter_blow_value_stats` (migration 0189). */
export interface BlowValueRow extends FighterBlowValueCounts {
  registrationId: string;
}

/**
 * How this tournament's ruleset values an afterblow, so a reader can label the
 * afterblow columns truthfully.
 *
 * The table heads them `✓2-1`: "struck for 2, took an afterblow worth 1". That
 * `-1` was hardcoded. It is FFAMHE's rule — `fixed`, worth 1 whatever it landed
 * on — but a ruleset may declare `weighted`, where the retaliation is worth the
 * target it hit and no single number can label the column. Null when the
 * ruleset has no afterblow concept at all.
 */
export interface AfterblowLabelRule {
  valuation: 'fixed' | 'weighted' | null;
  /** The retaliation's worth under `fixed`. Meaningless otherwise. */
  fixedValue: number | null;
}

export interface FighterStatsResponse {
  fighters: FighterExchangeStats[];
  afterblow: AfterblowLabelRule;
}

export interface FighterExchangeStats {
  registrationId: string;
  personId: string;
  givenName: string;
  familyName: string;
  clubName: string | null;
  doubles: number;
  /**
   * lyonamhe.fr blow columns, one entry per point value this fighter's bouts
   * actually produced, ascending.
   *
   * This was twelve fixed fields — `hitsGiven1` through `afterblowReceived3` —
   * so a target worth 4 or more was invisible in every one of them, while still
   * counting in `blowsGiven`/`blowsReceived` and both ratios. A target may be
   * worth 1 to 10. Migration 0189 keeps the raw value instead, so the set of
   * buckets is read from the data rather than declared in advance.
   */
  byValue: FighterBlowValueCounts[];
  // Extended blow-based columns (always count the blow, regardless of afterblow mode)
  blowsGiven: number;
  blowsReceived: number;
  afterblowsReceivedTotal: number;
  // Point-based columns (affected by afterblow mode: deductive → defender gets 0 pts)
  pointsGiven: number;
  pointsReceived: number;
  // Totals
  totalExchanges: number;
  /** Blow-based ratio (mode-independent) — defender afterblow in deductive still counts */
  hitRatio: number | null;
  /** Point-based ratio (affected by mode) */
  pointRatio: number | null;
}

export interface TournamentStatsOverview {
  tournamentId: string;
  participantCount: number;
  matchCount: number;
  exchangeCount: number;
  doublesCount: number;
  doublesPercent: number;
  clubCount: number;
  topFighters: Array<{
    name: string;
    club: string | null;
    hitRatio: number | null;
  }>;
}

/** One (fighter, point-value) CLEAN-hit count row from tournament_target_value_stats. */
export { aggregateTargetValues };
export type { TargetValueRow, TargetValueStats };

@Injectable()
export class StatsService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly rulesets: RulesetResolver,
  ) {}

  // ── Fighter exchange stats ────────────────────────────────────────────────────

  async getFighterStats(tournamentId: string): Promise<FighterStatsResponse> {
    // Two reads, because they answer two different questions and neither can be
    // folded into the other without repeating itself: one row per fighter for
    // the totals and ratios, one row per (fighter, point value) for the blow
    // buckets. Issued together — neither depends on the other's answer.
    const [fighters, blowValues, afterblow] = await Promise.all([
      this.fighterRows(tournamentId),
      this.blowValueRows(tournamentId),
      this.afterblowLabelRule(tournamentId),
    ]);
    return { fighters: StatsService.attachBlowValues(fighters, blowValues), afterblow };
  }

  async fighterRows(tournamentId: string): Promise<FighterExchangeStats[]> {
    // Computed on-read (always fresh); already ordered by hit_ratio DESC in SQL.
    const { data, error } = await this.supabase.service.rpc('fighter_exchange_stats', {
      p_tournament_id: tournamentId,
    });

    if (error) {
      // Function may not exist yet (pre-migration) — return empty
      return [];
    }

    return ((data as Array<Record<string, unknown>> | null) ?? []).map((r) => this.mapStats(r));
  }

  /**
   * Per-(fighter, point value) blow counts (migration 0189). A value with no
   * blows produces no row, so this is also how the caller learns which point
   * values the tournament used. Returns [] on error, mirroring the above.
   */
  async blowValueRows(tournamentId: string): Promise<BlowValueRow[]> {
    const { data, error } = await this.supabase.service.rpc('fighter_blow_value_stats', {
      p_tournament_id: tournamentId,
    });
    if (error) return [];
    return ((data as Array<Record<string, unknown>> | null) ?? []).map((r) => ({
      registrationId: r['registration_id'] as string,
      value: Number(r['point_value'] ?? 0),
      hitsGiven: Number(r['hits_given'] ?? 0),
      afterblowGiven: Number(r['afterblow_given'] ?? 0),
      hitsReceived: Number(r['hits_received'] ?? 0),
      afterblowReceived: Number(r['afterblow_received'] ?? 0),
    }));
  }

  /**
   * Hang each fighter's blow rows off their stats row, ascending by value.
   *
   * Pure and static so it is unit-testable without Supabase, the same shape as
   * `aggregateTargetValues` below.
   */
  static attachBlowValues(
    fighters: FighterExchangeStats[],
    rows: BlowValueRow[],
  ): FighterExchangeStats[] {
    const byRegistration = new Map<string, FighterBlowValueCounts[]>();
    for (const row of rows) {
      const { registrationId, ...counts } = row;
      const bucket = byRegistration.get(registrationId);
      if (bucket) bucket.push(counts);
      else byRegistration.set(registrationId, [counts]);
    }
    for (const bucket of byRegistration.values()) bucket.sort((a, b) => a.value - b.value);
    return fighters.map((fighter) => ({
      ...fighter,
      byValue: byRegistration.get(fighter.registrationId) ?? [],
    }));
  }

  /**
   * The tournament ruleset's afterblow valuation, for the column labels.
   *
   * Falls back to `{ valuation: null, fixedValue: null }` whenever the ruleset
   * cannot be resolved, which renders the afterblow columns with no worth
   * claimed rather than asserting FFAMHE's `-1` for a ruleset that never said
   * so.
   */
  private async afterblowLabelRule(tournamentId: string): Promise<AfterblowLabelRule> {
    const { data } = await this.supabase.service
      .from('tournaments')
      .select('ruleset_code, ruleset_version')
      .eq('id', tournamentId)
      .maybeSingle();
    const row = data as { ruleset_code?: string; ruleset_version?: string } | null;
    if (!row?.ruleset_code) return { valuation: null, fixedValue: null };

    const ruleset = await this.rulesets.resolve(
      row.ruleset_code,
      normalizeRulesetVersion(row.ruleset_version ?? '1'),
    );
    const metadata = ruleset?.metadata;
    if (!metadata?.hasAfterblow) return { valuation: null, fixedValue: null };
    return {
      valuation: metadata.afterblowValuation ?? null,
      fixedValue: metadata.afterblowFixedValue ?? null,
    };
  }

  // ── Target-value (point-value) stats ──────────────────────────────────────────

  /**
   * Per-(fighter, point-value) CLEAN-hit counts (migration 0135). Point-value
   * generic — supports 1/2/3+ so the "deep target" can be derived dynamically.
   * Returns [] on error (function may not exist yet pre-migration), mirroring
   * getFighterStats.
   */
  async getTargetValueRows(tournamentId: string): Promise<TargetValueRow[]> {
    const { data, error } = await this.supabase.service.rpc('tournament_target_value_stats', {
      p_tournament_id: tournamentId,
    });
    if (error) return [];
    return ((data as Array<Record<string, unknown>> | null) ?? []).map((r) => ({
      registrationId: r['registration_id'] as string,
      personId: r['person_id'] as string,
      givenName: r['given_name'] as string,
      familyName: r['family_name'] as string,
      clubName: (r['club_name'] as string | null) ?? null,
      pointValue: Number(r['point_value'] ?? 0),
      cleanHits: Number(r['clean_hits'] ?? 0),
    }));
  }

  /** Single-tournament aggregation for the public target-values endpoint. */
  async getTargetValueStats(tournamentId: string): Promise<TargetValueStats> {
    const rows = await this.getTargetValueRows(tournamentId);
    return aggregateTargetValues(rows);
  }

  // ── Tournament overview ───────────────────────────────────────────────────────

  async getTournamentOverview(tournamentId: string): Promise<TournamentStatsOverview> {
    const [statsRows, matchCount, exchangeCount] = await Promise.all([
      // The per-fighter rows only. This overview reads doubles, club,
      // both ratios and the blow totals -- all value-independent -- so it
      // needs neither the point-value buckets nor the afterblow label, and
      // skipping them saves two round trips per tournament.
      this.fighterRows(tournamentId),
      this.countMatches(tournamentId),
      this.countExchanges(tournamentId),
    ]);

    const doublesCount = statsRows.reduce((s, r) => s + r.doubles, 0) / 2; // each double counted twice
    const doublesPercent = exchangeCount > 0 ? Math.round((doublesCount / exchangeCount) * 100) : 0;

    const clubs = new Set(statsRows.map((r) => r.clubName).filter(Boolean));

    const topFighters = statsRows
      .filter((r) => r.hitRatio !== null)
      .slice(0, 5)
      .map((r) => ({
        name: `${r.givenName} ${r.familyName}`,
        club: r.clubName,
        hitRatio: r.hitRatio, // blow-based (mode-independent)
        pointRatio: r.pointRatio, // point-based (mode-dependent)
        blowsGiven: r.blowsGiven,
        blowsReceived: r.blowsReceived,
      }));

    return {
      tournamentId,
      participantCount: statsRows.length,
      matchCount,
      exchangeCount,
      doublesCount: Math.round(doublesCount),
      doublesPercent,
      clubCount: clubs.size,
      topFighters,
    };
  }

  // ── Private ───────────────────────────────────────────────────────────────────

  // matches/exchanges have NO tournament_id column — they reach a tournament only
  // via phase_id → phases.tournament_id (exchanges via match → phase). Filtering a
  // non-existent column PostgREST-400s the whole query; the error must be surfaced,
  // not swallowed into `count ?? 0` (which silently reported 0 for every tournament).
  private async countMatches(tournamentId: string): Promise<number> {
    const { count, error } = await this.supabase.service
      .from('matches')
      .select('id, phases!inner(tournament_id)', { count: 'exact', head: true })
      .eq('phases.tournament_id', tournamentId)
      .neq('status', 'voided');
    if (error) throw new Error(`countMatches failed: ${error.message}`);
    return count ?? 0;
  }

  private async countExchanges(tournamentId: string): Promise<number> {
    const { count, error } = await this.supabase.service
      .from('exchanges')
      .select('id, matches!inner(phases!inner(tournament_id))', { count: 'exact', head: true })
      .eq('matches.phases.tournament_id', tournamentId)
      .eq('voided', false);
    if (error) throw new Error(`countExchanges failed: ${error.message}`);
    return count ?? 0;
  }

  private mapStats(r: Record<string, unknown>): FighterExchangeStats {
    return {
      registrationId: r['registration_id'] as string,
      personId: r['person_id'] as string,
      givenName: r['given_name'] as string,
      familyName: r['family_name'] as string,
      clubName: (r['club_name'] as string | null) ?? null,
      doubles: Number(r['doubles'] ?? 0),
      // Filled by attachBlowValues from the second RPC; the per-fighter
      // function no longer knows which point values exist.
      byValue: [],
      blowsGiven: Number(r['blows_given'] ?? 0),
      blowsReceived: Number(r['blows_received'] ?? 0),
      afterblowsReceivedTotal: Number(r['afterblows_received_total'] ?? 0),
      pointsGiven: Number(r['points_given'] ?? 0),
      pointsReceived: Number(r['points_received'] ?? 0),
      totalExchanges: Number(r['total_exchanges'] ?? 0),
      hitRatio: r['hit_ratio'] != null ? Number(r['hit_ratio']) : null,
      pointRatio: r['point_ratio'] != null ? Number(r['point_ratio']) : null,
    };
  }
}
