/**
 * exports.service.ts — T-1004
 *
 * Generates CSV / JSON / HEMA Ratings format exports.
 *
 * HEMA Ratings format (exact spec):
 *
 * fighters.csv:
 *   Firstname Lastname,Club NAME,Nationality (2-letter),Gender (empty),HEMA Ratings ID (empty if unknown)
 *
 * {tournament-slug}.csv:
 *   Fighter1,Fighter2,Fighter1Result,Fighter2Result,Round
 *   Winner is always Fighter1. Draw = Draw,Draw.
 */

import { Injectable } from '@nestjs/common';
import { formatRoundCode } from '@myclash/types';
import { SupabaseService } from '../supabase/supabase.service';

// ── Types ─────────────────────────────────────────────────────────────────────

interface FighterRow {
  fullName: string; // "Firstname Lastname"
  clubName: string;
  nationality: string; // 2-letter country code
  hemaRatingsId: string; // numeric string or empty
}

interface MatchResultRow {
  fighter1: string;
  fighter2: string;
  fighter1Result: 'Win' | 'Loss' | 'Draw';
  fighter2Result: 'Win' | 'Loss' | 'Draw';
  round: string;
}

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable()
export class ExportsService {
  constructor(private readonly supabase: SupabaseService) {}

  // ── HEMA Ratings fighters.csv ─────────────────────────────────────────────

  async generateFightersCsv(eventId: string): Promise<string> {
    const { data: persons } = await this.supabase.service
      .from('persons')
      .select(
        `
        given_name, family_name, hema_ratings_id,
        clubs ( name, country_code )
      `,
      )
      .eq('event_id', eventId)
      .order('family_name')
      .order('given_name');

    const rows: FighterRow[] = (persons ?? []).map((p) => {
      const row = p as Record<string, unknown>;
      const club = row['clubs'] as { name: string; country_code?: string | null } | null;
      return {
        fullName: `${row['given_name'] as string} ${row['family_name'] as string}`,
        clubName: club?.name ?? '',
        nationality: club?.country_code ?? '',
        hemaRatingsId: (row['hema_ratings_id'] as string | null) ?? '',
      };
    });

    return this.buildFightersCsv(rows);
  }

  // ── HEMA Ratings tournament results CSV ───────────────────────────────────

  async generateTournamentResultsCsv(
    tournamentId: string,
    tournamentSlug: string,
  ): Promise<{ filename: string; content: string }> {
    // Fetch all completed matches with fighter names and phase info
    const { data: matches } = await this.supabase.service
      .from('matches')
      .select(
        `
        id, status, winner_registration_id,
        match_number_label,
        red_registration_id, blue_registration_id,
        pools ( name ),
        phases ( type, sort_order ),
        red_reg:registrations!red_registration_id (
          persons ( given_name, family_name )
        ),
        blue_reg:registrations!blue_registration_id (
          persons ( given_name, family_name )
        )
      `,
      )
      .eq('tournament_id', tournamentId)
      .eq('status', 'completed')
      .order('match_number_label');

    const rows: MatchResultRow[] = (matches ?? []).map((m) => {
      const row = m as Record<string, unknown>;

      const redReg = row['red_reg'] as {
        persons: { given_name: string; family_name: string } | null;
      } | null;
      const blueReg = row['blue_reg'] as {
        persons: { given_name: string; family_name: string } | null;
      } | null;
      const pool = row['pools'] as { name: string } | null;
      const phase = row['phases'] as { type: string; sort_order: number } | null;

      const redName = redReg?.persons
        ? `${redReg.persons.given_name} ${redReg.persons.family_name}`
        : 'Unknown';
      const blueName = blueReg?.persons
        ? `${blueReg.persons.given_name} ${blueReg.persons.family_name}`
        : 'Unknown';

      const winnerId = row['winner_registration_id'] as string | null;
      const redRegId = row['red_registration_id'] as string;
      const _blueRegId = row['blue_registration_id'] as string;

      const round = this.resolveRound(
        phase?.type ?? '',
        pool?.name ?? null,
        row['match_number_label'] as string | null,
      );

      // Winner is always Fighter1 per HEMA Ratings spec
      if (!winnerId) {
        // Draw
        return {
          fighter1: redName,
          fighter2: blueName,
          fighter1Result: 'Draw',
          fighter2Result: 'Draw',
          round,
        };
      } else if (winnerId === redRegId) {
        // Red won → red is Fighter1
        return {
          fighter1: redName,
          fighter2: blueName,
          fighter1Result: 'Win',
          fighter2Result: 'Loss',
          round,
        };
      } else {
        // Blue won → blue is Fighter1 (winner always first)
        return {
          fighter1: blueName,
          fighter2: redName,
          fighter1Result: 'Win',
          fighter2Result: 'Loss',
          round,
        };
      }
    });

    return {
      filename: `${tournamentSlug}.csv`,
      content: this.buildResultsCsv(rows),
    };
  }

  // ── Generic CSV export (all matches + exchanges) ──────────────────────────

  async generateFullCsv(eventId: string): Promise<string> {
    const { data: exchanges } = await this.supabase.service
      .from('exchanges')
      .select(
        `
        id, type, sequence, occurred_at, clock_time_ms,
        first_striker_color, first_strike_value, afterblow_value,
        no_exchange_reason, voided, voided_reason,
        matches (
          id, match_number_label, status,
          red_registration_id, blue_registration_id,
          pools ( sort_order ),
          bracket_slots ( round ),
          phases ( tournaments ( name, slug, weapon, bracket_size ) )
        )
      `,
      )
      .eq('matches.phases.tournaments.event_id', eventId)
      .order('occurred_at');

    const lines = [
      'tournament,round_code,match,sequence,type,first_striker,first_strike_value,afterblow_value,no_exchange_reason,clock_time_ms,voided,voided_reason',
    ];

    for (const ex of exchanges ?? []) {
      const row = ex as Record<string, unknown>;
      const match = row['matches'] as Record<string, unknown> | null;
      const phase = match?.['phases'] as Record<string, unknown> | null;
      const tournament = phase?.['tournaments'] as {
        name: string;
        weapon?: string | null;
        bracket_size?: number | null;
      } | null;
      const pool = match?.['pools'] as { sort_order?: number } | null;
      const bracketSlot = match?.['bracket_slots'] as { round?: number } | null;
      const matchLabel = (match?.['match_number_label'] as string | null) ?? '';

      const roundCode = formatRoundCode({
        weapon: tournament?.weapon ?? null,
        poolNumber: typeof pool?.sort_order === 'number' ? pool.sort_order + 1 : null,
        bracketRound: typeof bracketSlot?.round === 'number' ? bracketSlot.round : null,
        bracketSize: tournament?.bracket_size ?? null,
        matchNumber: matchLabel || null,
      });

      lines.push(
        [
          this.csvEscape(tournament?.name ?? ''),
          this.csvEscape(roundCode),
          this.csvEscape(matchLabel),
          row['sequence'],
          row['type'],
          row['first_striker_color'] ?? '',
          row['first_strike_value'] ?? '',
          row['afterblow_value'] ?? '',
          row['no_exchange_reason'] ?? '',
          row['clock_time_ms'] ?? '',
          row['voided'] ? 'true' : 'false',
          this.csvEscape((row['voided_reason'] as string | null) ?? ''),
        ].join(','),
      );
    }

    return lines.join('\n');
  }

  // ── JSON export ───────────────────────────────────────────────────────────

  async generateEventJson(eventId: string): Promise<object> {
    const [eventRes, tournamentsRes] = await Promise.all([
      this.supabase.service
        .from('events')
        .select('*, organizations ( name, slug )')
        .eq('id', eventId)
        .maybeSingle(),
      this.supabase.service
        .from('tournaments')
        .select(
          `
          *,
          phases (
            *,
            pools ( *, pool_members ( * ) ),
            matches (
              *,
              exchanges ( * )
            )
          )
        `,
        )
        .eq('event_id', eventId),
    ]);

    return {
      event: eventRes.data,
      tournaments: tournamentsRes.data ?? [],
      exportedAt: new Date().toISOString(),
      version: '1.0',
    };
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private buildFightersCsv(rows: FighterRow[]): string {
    // No header row — HEMA Ratings format has no header
    return rows
      .map((r) =>
        [
          this.csvEscape(r.fullName),
          this.csvEscape(r.clubName),
          r.nationality,
          '', // Gender — kept for backward compatibility, always empty
          r.hemaRatingsId,
        ].join(','),
      )
      .join('\n');
  }

  private buildResultsCsv(rows: MatchResultRow[]): string {
    // No header row — HEMA Ratings format has no header
    return rows
      .map((r) =>
        [
          this.csvEscape(r.fighter1),
          this.csvEscape(r.fighter2),
          r.fighter1Result,
          r.fighter2Result,
          this.csvEscape(r.round),
        ].join(','),
      )
      .join('\n');
  }

  /**
   * Resolve the round label for HEMA Ratings export.
   *
   * Pool matches → "Pools"
   * Bracket matches → "Top 64", "Top 32", "Top 16", "Quarter-finals", "Semi-finals", "Gold Medal Match", "Bronze Medal Match"
   * Uses match_number_label as fallback.
   */
  private resolveRound(
    phaseType: string,
    poolName: string | null,
    matchLabel: string | null,
  ): string {
    if (phaseType === 'pool') {
      return 'Pools';
    }

    if (phaseType === 'single_elim') {
      // Try to infer from match label (e.g. "F" = Gold Medal, "SF1" = Semi-final, "3rd" = Bronze)
      const label = (matchLabel ?? '').toUpperCase();
      // Bronze must be checked BEFORE Final (label may contain both "FINAL" and "BRONZE")
      if (label.includes('BRONZE') || label.includes('3RD') || label.includes('3RD PLACE')) {
        return 'Bronze Medal Match';
      }
      if (label.includes('FINAL') || label === 'F') return 'Gold Medal Match';
      if (label.includes('SF') || label.includes('SEMI')) return 'Semi-finals';
      if (label.includes('QF') || label.includes('QUARTER')) return 'Quarter-finals';
      if (label.includes('R16') || label.includes('TOP16') || label.includes('TOP 16'))
        return 'Top 16';
      if (label.includes('R32') || label.includes('TOP32') || label.includes('TOP 32'))
        return 'Top 32';
      if (label.includes('R64') || label.includes('TOP64') || label.includes('TOP 64'))
        return 'Top 64';
      // Fallback: use the label as-is
      return matchLabel ?? 'Elimination';
    }

    return poolName ?? matchLabel ?? 'Unknown';
  }

  private csvEscape(value: string): string {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }
}
