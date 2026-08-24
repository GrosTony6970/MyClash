import { BadRequestException, Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import {
  computeRankingsFromContributions,
  groupKey,
  medalFor,
  pointsForRank,
} from '@myclash/rules/results';
import type {
  LeagueRankingRow,
  LeagueScoringConfig,
  LeagueTieBreaker,
  LeagueTournamentContribution,
  TournamentContributionInput,
} from '@myclash/rules/results';

@Injectable()
export class LeagueScoringService {
  // SupabaseService is optional so existing unit tests that instantiate
  // LeagueScoringService with no args (pure scoring math) keep working.
  constructor(private readonly supabase?: SupabaseService) {}

  pointsForRank(config: LeagueScoringConfig, finalRank: number): number {
    return pointsForRank(config, finalRank);
  }

  /**
   * Hydrate a league scoring config by resolving its `scoringSystem`
   * reference against the `league_scoring_systems` registry (migration
   * 0068) and `league_scoring_system_versions` (migration 0087).
   *
   * `scoringSystem` may be:
   *   - 'custom'                  → per-league inline config, no lookup
   *   - 'code'                    → resolves to the registry's current row
   *                                 (pre-0087 behaviour; backwards safe)
   *   - 'code@version'            → resolves to the pinned version's
   *                                 points_by_rank from the versions table;
   *                                 falls back to the current row if the
   *                                 version row doesn't exist (defensive)
   *
   * Per-league `'custom'` configs are returned unchanged. Unknown /
   * archived codes also pass through (caller falls back to the
   * hard-coded table via `pointsForRank`).
   */
  async resolveConfig(config: LeagueScoringConfig): Promise<LeagueScoringConfig> {
    if (config.scoringSystem === 'custom') return config;
    if (config.customPointsByRank) return config;
    if (!this.supabase) return config;

    const { code, version } = parseScoringSystemReference(config.scoringSystem);

    if (version) {
      // First find the registry row by code (active only) so we have its id.
      const { data: systemData, error: systemError } = await this.supabase.service
        .from('league_scoring_systems')
        .select('id, points_by_rank, tie_breakers')
        .eq('code', code)
        .eq('is_archived', false)
        .maybeSingle();
      if (systemError || !systemData) return config;

      // Look up the pinned version's snapshot.
      const { data: versionData, error: versionError } = await this.supabase.service
        .from('league_scoring_system_versions')
        .select('points_by_rank, tie_breakers')
        .eq('league_scoring_system_id', (systemData as { id: string }).id)
        .eq('version', version)
        .maybeSingle();
      if (!versionError && versionData) {
        return applyResolved(config, versionData as ResolvedRow);
      }
      // Defensive fallback: pinned version row is missing — fall back to the
      // current registry row so leagues never silently return zero points.
      return applyResolved(config, systemData as ResolvedRow);
    }

    // No version pinned (legacy code-only reference). Resolve to current row.
    const { data, error } = await this.supabase.service
      .from('league_scoring_systems')
      .select('points_by_rank, tie_breakers')
      .eq('code', code)
      .eq('is_archived', false)
      .maybeSingle();
    if (error || !data) return config;
    return applyResolved(config, data as ResolvedRow);
  }

  groupKey(config: LeagueScoringConfig, contribution: TournamentContributionInput): string {
    return groupKey(config, contribution);
  }

  validateContributionIdentities(contributions: TournamentContributionInput[]): void {
    const missing = contributions.filter((row) => !row.fighterId);
    if (missing.length === 0) return;

    const names = missing
      .map((row) => row.fighterName)
      .filter(Boolean)
      .slice(0, 5)
      .join(', ');
    throw new BadRequestException(
      `League calculation requires global Fighter links for every registration. Missing: ${names}`,
    );
  }

  toTournamentContributions(
    config: LeagueScoringConfig,
    inputs: TournamentContributionInput[],
  ): LeagueTournamentContribution[] {
    this.validateContributionIdentities(inputs);

    return inputs.map((input) => {
      const finalRank = Number(input.finalRank);
      return {
        leagueId: input.leagueId,
        tournamentId: input.tournamentId,
        eventId: input.eventId,
        fighterId: input.fighterId!,
        fighterName: input.fighterName,
        clubName: input.clubName,
        clubCity: input.clubCity,
        rankingGroupKey: this.groupKey(config, input),
        weapon: input.weapon,
        groupName: input.groupName,
        finalRank,
        leaguePoints: this.pointsForRank(config, finalRank),
        medal: medalFor(input.resultKind, finalRank),
        doubleHits: Math.max(0, Number(input.doubleHits) || 0),
      };
    });
  }

  computeRankings(
    config: LeagueScoringConfig,
    inputs: TournamentContributionInput[],
  ): LeagueRankingRow[] {
    const contributions = this.toTournamentContributions(config, inputs);
    return this.computeRankingsFromContributions(config, contributions);
  }

  computeRankingsFromContributions(
    config: Pick<LeagueScoringConfig, 'tieBreakers'>,
    contributions: LeagueTournamentContribution[],
  ): LeagueRankingRow[] {
    return computeRankingsFromContributions(config, contributions);
  }
}

/**
 * Parse a scoring-system reference into its code + optional version
 * components. Post-migration 0087, leagues store 'code@version'
 * (e.g. 'ffamhe_tf_2026@1.0.0'). Pre-migration values were just 'code'.
 * Tolerant of both: pre-migration leagues resolve to the current
 * registry row; pinned leagues resolve to their snapshot.
 */
export function parseScoringSystemReference(reference: string): {
  code: string;
  version: string | null;
} {
  if (typeof reference !== 'string' || reference.length === 0) {
    return { code: reference, version: null };
  }
  const at = reference.indexOf('@');
  if (at < 0) return { code: reference, version: null };
  const code = reference.slice(0, at);
  const version = reference.slice(at + 1);
  return { code, version: version.length > 0 ? version : null };
}

type ResolvedRow = {
  points_by_rank?: Record<string, number>;
  tie_breakers?: string[];
};

function applyResolved(config: LeagueScoringConfig, row: ResolvedRow): LeagueScoringConfig {
  const raw = row.points_by_rank ?? {};
  const pointsByRank: Record<number, number> = {};
  for (const [k, v] of Object.entries(raw)) {
    const rank = Number(k);
    const pts = Number(v);
    if (Number.isInteger(rank) && Number.isFinite(pts)) {
      pointsByRank[rank] = Math.max(0, Math.round(pts));
    }
  }
  const tieBreakersRaw = row.tie_breakers;
  const tieBreakers =
    Array.isArray(tieBreakersRaw) && tieBreakersRaw.length > 0
      ? (tieBreakersRaw as LeagueTieBreaker[])
      : config.tieBreakers;

  return { ...config, customPointsByRank: pointsByRank, tieBreakers };
}
