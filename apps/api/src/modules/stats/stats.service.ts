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
import { SupabaseService } from '../supabase/supabase.service';

export interface FighterExchangeStats {
  registrationId: string;
  personId: string;
  givenName: string;
  familyName: string;
  clubName: string | null;
  doubles: number;
  // lyonamhe.fr blow columns (mode-independent blow counts)
  hitsGiven1: number;
  afterblowGiven1: number;
  hitsGiven2: number;
  afterblowGiven2: number;
  // Value-3 buckets (migration 0136) — 0 for the common 1/2-only rulesets
  hitsGiven3: number;
  afterblowGiven3: number;
  hitsReceived1: number;
  afterblowReceived1: number;
  hitsReceived2: number;
  afterblowReceived2: number;
  hitsReceived3: number;
  afterblowReceived3: number;
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
export interface TargetValueRow {
  registrationId: string;
  personId: string;
  givenName: string;
  familyName: string;
  clubName: string | null;
  pointValue: number;
  cleanHits: number;
}

/** Aggregated point-value stats for a tournament (or a weapon group). */
export interface TargetValueStats {
  /** Highest point value present (the "deep target"); null when there are no clean hits. */
  maxValue: number | null;
  /** Total clean hits per point value, ascending by value (stacked-bar source). */
  distribution: Array<{ value: number; cleanHits: number }>;
  /** Top-5 fighters by clean hits AT maxValue; ties by name. */
  hunters: Array<{ personId: string; name: string; club: string | null; cleanHits: number }>;
}

@Injectable()
export class StatsService {
  constructor(private readonly supabase: SupabaseService) {}

  // ── Fighter exchange stats ────────────────────────────────────────────────────

  async getFighterStats(tournamentId: string): Promise<FighterExchangeStats[]> {
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
    return StatsService.aggregateTargetValues(rows);
  }

  /**
   * Pure aggregation of target-value rows into { maxValue, distribution, hunters }.
   * Accepts rows from one or several tournaments (concatenated) of the same weapon;
   * the deep-target hunters are merged by personId across them. No Supabase — unit-testable.
   */
  static aggregateTargetValues(rows: TargetValueRow[]): TargetValueStats {
    if (rows.length === 0) return { maxValue: null, distribution: [], hunters: [] };

    // Distribution: sum clean hits per value, ascending.
    const byValue = new Map<number, number>();
    for (const r of rows) byValue.set(r.pointValue, (byValue.get(r.pointValue) ?? 0) + r.cleanHits);
    const distribution = [...byValue.entries()]
      .map(([value, cleanHits]) => ({ value, cleanHits }))
      .sort((a, b) => a.value - b.value);

    const lastBucket = distribution[distribution.length - 1];
    const maxValue = lastBucket ? lastBucket.value : null;

    // Hunters: clean hits AT maxValue, merged by person (a person can span
    // tournaments of the same weapon).
    const byPerson = new Map<
      string,
      { personId: string; name: string; club: string | null; cleanHits: number }
    >();
    for (const r of rows) {
      if (r.pointValue !== maxValue) continue;
      const existing = byPerson.get(r.personId);
      if (existing) {
        existing.cleanHits += r.cleanHits;
        existing.club ??= r.clubName;
      } else {
        byPerson.set(r.personId, {
          personId: r.personId,
          name: `${r.givenName} ${r.familyName}`.trim(),
          club: r.clubName,
          cleanHits: r.cleanHits,
        });
      }
    }

    const hunters = [...byPerson.values()]
      .filter((h) => h.cleanHits > 0)
      .sort(
        (a, b) =>
          b.cleanHits - a.cleanHits ||
          a.name.localeCompare(b.name) ||
          a.personId.localeCompare(b.personId),
      )
      .slice(0, 5);

    return { maxValue, distribution, hunters };
  }

  // ── Tournament overview ───────────────────────────────────────────────────────

  async getTournamentOverview(tournamentId: string): Promise<TournamentStatsOverview> {
    const [statsRows, matchCount, exchangeCount] = await Promise.all([
      this.getFighterStats(tournamentId),
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
      hitsGiven1: Number(r['hits_given_1'] ?? 0),
      afterblowGiven1: Number(r['afterblow_given_1'] ?? 0),
      hitsGiven2: Number(r['hits_given_2'] ?? 0),
      afterblowGiven2: Number(r['afterblow_given_2'] ?? 0),
      hitsGiven3: Number(r['hits_given_3'] ?? 0),
      afterblowGiven3: Number(r['afterblow_given_3'] ?? 0),
      hitsReceived1: Number(r['hits_received_1'] ?? 0),
      afterblowReceived1: Number(r['afterblow_received_1'] ?? 0),
      hitsReceived2: Number(r['hits_received_2'] ?? 0),
      afterblowReceived2: Number(r['afterblow_received_2'] ?? 0),
      hitsReceived3: Number(r['hits_received_3'] ?? 0),
      afterblowReceived3: Number(r['afterblow_received_3'] ?? 0),
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
