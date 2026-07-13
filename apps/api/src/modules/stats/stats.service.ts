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
  hitsReceived1: number;
  afterblowReceived1: number;
  hitsReceived2: number;
  afterblowReceived2: number;
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

  private async countMatches(tournamentId: string): Promise<number> {
    const { count } = await this.supabase.service
      .from('matches')
      .select('id', { count: 'exact', head: true })
      .eq('tournament_id', tournamentId)
      .neq('status', 'voided');
    return count ?? 0;
  }

  private async countExchanges(tournamentId: string): Promise<number> {
    const { count } = await this.supabase.service
      .from('exchanges')
      .select('id', { count: 'exact', head: true })
      .eq('tournament_id', tournamentId)
      .eq('voided', false);
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
      hitsReceived1: Number(r['hits_received_1'] ?? 0),
      afterblowReceived1: Number(r['afterblow_received_1'] ?? 0),
      hitsReceived2: Number(r['hits_received_2'] ?? 0),
      afterblowReceived2: Number(r['afterblow_received_2'] ?? 0),
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
