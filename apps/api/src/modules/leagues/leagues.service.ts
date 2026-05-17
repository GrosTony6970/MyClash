import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrganizationsService } from '../organizations/organizations.service';
import { SupabaseService } from '../supabase/supabase.service';
import {
  DEFAULT_LEAGUE_SCORING_CONFIG,
  type LeagueRankingRow,
  type LeagueScoringConfig,
  type LeagueTournamentContribution,
  type TournamentContributionInput,
} from './league.types';
import { LeagueScoringService } from './league-scoring.service';
import type {
  AddLeagueOrganizationRoleDto,
  AddLeagueUserRoleDto,
  CreateLeagueDto,
  UpdateLeagueDto,
} from './dto/leagues.dto';

type Row = Record<string, unknown>;

@Injectable()
export class LeaguesService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly orgs: OrganizationsService,
    private readonly scoring: LeagueScoringService,
  ) {}

  async listPublic(seasonYear?: number) {
    let q = this.supabase.service
      .from('leagues')
      .select('*')
      .eq('public_visibility', true)
      .eq('status', 'published')
      .order('season_year', { ascending: false });
    if (seasonYear) q = q.eq('season_year', seasonYear) as typeof q;
    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async getPublicBySlug(slug: string) {
    const { data, error } = await this.supabase.service
      .from('leagues')
      .select('*')
      .eq('slug', slug)
      .eq('status', 'published')
      .eq('public_visibility', true)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException(`League ${slug} not found`);
    return data;
  }

  async listManageable(userId: string) {
    if (await this.isSuperAdmin(userId)) {
      const { data, error } = await this.supabase.service
        .from('leagues')
        .select('*')
        .order('season_year', { ascending: false });
      if (error) throw new BadRequestException(error.message);
      return data ?? [];
    }

    const [userRoles, orgMemberships] = await Promise.all([
      this.listRows('league_user_roles', 'user_id', userId),
      this.listRows('organization_members', 'user_id', userId),
    ]);
    const leagueIds = new Set(userRoles.map((row) => String(row['league_id'])));
    const orgIds = orgMemberships
      .filter((row) => ['admin', 'owner'].includes(String(row['role'])))
      .map((row) => String(row['organization_id']));
    if (orgIds.length > 0) {
      const { data } = await this.supabase.service
        .from('league_organization_roles')
        .select('league_id')
        .in('organization_id', orgIds)
        .in('role', ['admin', 'owner']);
      for (const row of (data ?? []) as Row[]) leagueIds.add(String(row['league_id']));
    }

    if (leagueIds.size === 0) return [];
    const { data, error } = await this.supabase.service
      .from('leagues')
      .select('*')
      .in('id', [...leagueIds])
      .order('season_year', { ascending: false });
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async create(dto: CreateLeagueDto, userId: string) {
    if (dto.ownerOrganizationId && !(await this.isSuperAdmin(userId))) {
      await this.orgs.assertOrgRole(dto.ownerOrganizationId, userId, 'admin');
    }
    const scoringConfig = normalizeScoringConfig(dto);
    const { data, error } = await this.supabase.service
      .from('leagues')
      .insert({
        name: dto.name.trim(),
        slug: dto.slug,
        season_year: dto.seasonYear,
        description: dto.description ?? null,
        logo_url: dto.logoUrl ?? null,
        scoring_system: scoringConfig.scoringSystem,
        scoring_config: scoringConfig,
        created_by_user_id: userId,
      })
      .select('*')
      .single();
    if (error) {
      if (error.message.includes('duplicate')) throw new ConflictException('League slug exists');
      throw new BadRequestException(error.message);
    }
    const leagueId = String((data as Row)['id']);
    await this.supabase.service.from('league_user_roles').upsert({
      league_id: leagueId,
      user_id: userId,
      role: 'owner',
    });
    if (dto.ownerOrganizationId) {
      await this.supabase.service.from('league_organization_roles').upsert({
        league_id: leagueId,
        organization_id: dto.ownerOrganizationId,
        role: 'owner',
      });
    }
    return data;
  }

  async update(leagueId: string, dto: UpdateLeagueDto, userId: string) {
    await this.assertCanManageLeague(leagueId, userId);
    const updates: Row = { updated_at: new Date().toISOString() };
    if (dto.name !== undefined) updates['name'] = dto.name.trim();
    if (dto.description !== undefined) updates['description'] = dto.description;
    if (dto.logoUrl !== undefined) updates['logo_url'] = dto.logoUrl;
    if (dto.status !== undefined) updates['status'] = dto.status;
    if (dto.publicVisibility !== undefined) updates['public_visibility'] = dto.publicVisibility;
    if (dto.scoringConfig !== undefined) {
      const scoringConfig = normalizeScoringConfig(dto.scoringConfig);
      updates['scoring_config'] = scoringConfig;
      updates['scoring_system'] = scoringConfig.scoringSystem;
    }

    const { data, error } = await this.supabase.service
      .from('leagues')
      .update(updates)
      .eq('id', leagueId)
      .select('*')
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async delete(leagueId: string, userId: string): Promise<void> {
    await this.assertCanManageLeague(leagueId, userId);
    const { error } = await this.supabase.service.from('leagues').delete().eq('id', leagueId);
    if (error) throw new BadRequestException(error.message);
  }

  async addOrganizationRole(leagueId: string, dto: AddLeagueOrganizationRoleDto, userId: string) {
    await this.assertCanManageLeague(leagueId, userId);
    const { data, error } = await this.supabase.service
      .from('league_organization_roles')
      .upsert({
        league_id: leagueId,
        organization_id: dto.organizationId,
        role: dto.role,
      })
      .select('*')
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async addUserRole(leagueId: string, dto: AddLeagueUserRoleDto, userId: string) {
    await this.assertCanManageLeague(leagueId, userId);
    const { data, error } = await this.supabase.service
      .from('league_user_roles')
      .upsert({ league_id: leagueId, user_id: dto.userId, role: dto.role })
      .select('*')
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async requestTournamentLink(leagueId: string, tournamentId: string, userId: string) {
    const tournament = await this.getTournamentWithEvent(tournamentId);
    await this.orgs.assertOrgRole(String(tournament['organization_id']), userId, 'admin');
    const { data, error } = await this.supabase.service
      .from('league_tournament_links')
      .upsert(
        {
          league_id: leagueId,
          tournament_id: tournamentId,
          status: 'requested',
          requested_by_user_id: userId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'league_id,tournament_id' },
      )
      .select('*')
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async listTournamentLinks(leagueId: string, userId: string) {
    await this.assertCanManageLeague(leagueId, userId);
    const { data, error } = await this.supabase.service
      .from('league_tournament_links')
      .select('*, tournaments(id, name, weapon, category, events(id, name, start_date))')
      .eq('league_id', leagueId)
      .order('created_at', { ascending: false });
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async reviewTournamentLink(
    linkId: string,
    status: 'approved' | 'rejected' | 'removed',
    userId: string,
  ) {
    const { data: link } = await this.supabase.service
      .from('league_tournament_links')
      .select('*')
      .eq('id', linkId)
      .maybeSingle();
    if (!link) throw new NotFoundException(`League tournament link ${linkId} not found`);
    await this.assertCanManageLeague(String((link as Row)['league_id']), userId);

    const { data, error } = await this.supabase.service
      .from('league_tournament_links')
      .update({
        status,
        reviewed_by_user_id: userId,
        reviewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', linkId)
      .select('*')
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async recomputeForEvent(eventId: string, userId?: string) {
    if (userId) {
      const { data: event } = await this.supabase.service
        .from('events')
        .select('organization_id')
        .eq('id', eventId)
        .maybeSingle();
      if (!event) throw new NotFoundException(`Event ${eventId} not found`);
      await this.orgs.assertOrgRole(String((event as Row)['organization_id']), userId, 'admin');
    }

    const { data: tournaments, error: tournamentError } = await this.supabase.service
      .from('tournaments')
      .select('id')
      .eq('event_id', eventId);
    if (tournamentError) throw new BadRequestException(tournamentError.message);
    const tournamentIds = ((tournaments ?? []) as Row[]).map((row) => String(row['id']));
    if (tournamentIds.length === 0) return { eventId, recomputedLeagues: [] };

    const { data: links, error: linksError } = await this.supabase.service
      .from('league_tournament_links')
      .select('*, leagues(*)')
      .in('tournament_id', tournamentIds)
      .eq('status', 'approved');
    if (linksError) throw new BadRequestException(linksError.message);

    const affectedLeagueIds = new Set<string>();
    for (const link of (links ?? []) as Row[]) {
      const league = link['leagues'] as Row | null;
      if (!league) continue;
      const config = normalizeScoringConfig(league['scoring_config']);
      const contributions = await this.computeTournamentContributions(
        String(link['league_id']),
        String(link['tournament_id']),
        config,
      );
      await this.replaceTournamentResults(
        String(link['league_id']),
        String(link['tournament_id']),
        contributions,
      );
      affectedLeagueIds.add(String(link['league_id']));
    }

    for (const leagueId of affectedLeagueIds) {
      await this.recomputeLeagueRankings(leagueId);
    }

    return { eventId, recomputedLeagues: [...affectedLeagueIds] };
  }

  async recomputeLeagueRankings(leagueId: string, userId?: string) {
    if (userId) await this.assertCanManageLeague(leagueId, userId);
    const league = await this.getLeagueById(leagueId);
    const config = normalizeScoringConfig(league['scoring_config']);
    const rows = await this.listRows('league_tournament_results', 'league_id', leagueId);
    const contributions: LeagueTournamentContribution[] = rows.map((row) => ({
      leagueId,
      tournamentId: String(row['tournament_id']),
      eventId: String(row['event_id']),
      fighterId: String(row['fighter_id']),
      fighterName: '',
      clubName: null,
      clubCity: null,
      rankingGroupKey: String(row['ranking_group_key']),
      weapon: null,
      category: null,
      finalRank: Number(row['final_rank']),
      leaguePoints: Number(row['league_points']),
      medal: (row['medal'] as LeagueTournamentContribution['medal']) ?? null,
      doubleHits: Number(row['double_hits'] ?? 0),
    }));
    const rankings = this.scoring.computeRankingsFromContributions(config, contributions);
    await this.replaceRankings(leagueId, rankings);
    return rankings;
  }

  async standings(leagueId: string, group?: string) {
    const league = await this.getLeagueById(leagueId);
    if (league['public_visibility'] !== true || league['status'] !== 'published') {
      throw new NotFoundException(`League ${leagueId} not found`);
    }
    let q = this.supabase.service
      .from('league_rankings')
      .select('*, global_persons(display_name, clubs(name, city))')
      .eq('league_id', leagueId)
      .order('ranking_group_key', { ascending: true })
      .order('rank', { ascending: true });
    if (group) q = q.eq('ranking_group_key', group) as typeof q;
    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);

    const { data: links } = await this.supabase.service
      .from('league_tournament_links')
      .select('tournament_id, tournaments(id, name, event_id, events(name, start_date))')
      .eq('league_id', leagueId)
      .eq('status', 'approved');

    return {
      league,
      columns: links ?? [],
      rows: data ?? [],
    };
  }

  async finalReportCsv(leagueId: string): Promise<string> {
    const standings = await this.standings(leagueId);
    const lines = [
      'ranking_group,league_rank,fighter,total_points,participation_count,medal_count,double_hit_average',
    ];
    for (const row of standings.rows as Row[]) {
      const fighter = row['global_persons'] as Row | null;
      lines.push(
        [
          csv(row['ranking_group_key']),
          csv(row['rank']),
          csv(fighter?.['display_name'] ?? row['fighter_id']),
          csv(row['total_points']),
          csv(row['participation_count']),
          csv(row['medal_count']),
          csv(row['double_hit_average']),
        ].join(','),
      );
    }
    return `${lines.join('\n')}\n`;
  }

  async finalReportHtml(leagueId: string): Promise<string> {
    const standings = await this.standings(leagueId);
    const league = standings.league as Row;
    const rows = (standings.rows as Row[])
      .map((row) => {
        const fighter = row['global_persons'] as Row | null;
        return `<tr><td>${escapeHtml(row['ranking_group_key'])}</td><td>${escapeHtml(row['rank'])}</td><td>${escapeHtml(fighter?.['display_name'] ?? row['fighter_id'])}</td><td>${escapeHtml(row['total_points'])}</td></tr>`;
      })
      .join('');
    return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(league['name'])}</title><style>body{font-family:Arial,sans-serif}table{border-collapse:collapse;width:100%}td,th{border:1px solid #999;padding:6px}.medal{font-weight:700}</style></head><body><h1>${escapeHtml(league['name'])}</h1><table><thead><tr><th>Group</th><th>Rank</th><th>Fighter</th><th>Points</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
  }

  private async computeTournamentContributions(
    leagueId: string,
    tournamentId: string,
    config: LeagueScoringConfig,
  ): Promise<LeagueTournamentContribution[]> {
    const tournament = await this.getTournamentWithEvent(tournamentId);
    const [registrations, matches] = await Promise.all([
      this.listRows('registrations', 'tournament_id', tournamentId),
      this.listMatchesForTournament(tournamentId),
    ]);
    const matchIds = matches.map((match) => String(match['id']));
    const exchanges =
      matchIds.length === 0 ? [] : await this.listRowsIn('exchanges', 'match_id', matchIds);
    const doubleHits = this.doubleHitsByRegistration(matches, exchanges);
    const rankedInputs = this.rankTournament(
      leagueId,
      tournament,
      registrations,
      matches,
      doubleHits,
    );
    return this.scoring.toTournamentContributions(config, rankedInputs);
  }

  private rankTournament(
    leagueId: string,
    tournament: Row,
    registrations: Row[],
    matches: Row[],
    doubleHits: Map<string, number>,
  ): TournamentContributionInput[] {
    const stats = new Map<string, { wins: number; pointsFor: number; pointsAgainst: number }>();
    for (const registration of registrations) {
      stats.set(String(registration['id']), { wins: 0, pointsFor: 0, pointsAgainst: 0 });
    }
    for (const match of matches) {
      if (match['status'] !== 'completed') continue;
      const redId = String(match['red_registration_id'] ?? '');
      const blueId = String(match['blue_registration_id'] ?? '');
      const red = stats.get(redId);
      const blue = stats.get(blueId);
      if (!red || !blue) continue;
      const redScore = Number(match['red_score'] ?? 0);
      const blueScore = Number(match['blue_score'] ?? 0);
      red.pointsFor += redScore;
      red.pointsAgainst += blueScore;
      blue.pointsFor += blueScore;
      blue.pointsAgainst += redScore;
      if (match['winner_registration_id'] === redId) red.wins += 1;
      if (match['winner_registration_id'] === blueId) blue.wins += 1;
    }

    return registrations
      .map((registration) => {
        const stat = stats.get(String(registration['id'])) ?? {
          wins: 0,
          pointsFor: 0,
          pointsAgainst: 0,
        };
        return { registration, stat };
      })
      .sort((a, b) => {
        if (b.stat.wins !== a.stat.wins) return b.stat.wins - a.stat.wins;
        const aDiff = a.stat.pointsFor - a.stat.pointsAgainst;
        const bDiff = b.stat.pointsFor - b.stat.pointsAgainst;
        if (bDiff !== aDiff) return bDiff - aDiff;
        if (b.stat.pointsFor !== a.stat.pointsFor) return b.stat.pointsFor - a.stat.pointsFor;
        return Number(a.registration['seed'] ?? 9999) - Number(b.registration['seed'] ?? 9999);
      })
      .map(({ registration }, index) => {
        const person = registration['persons'] as Row | null;
        const fighter = registration['global_persons'] as Row | null;
        const name =
          String(fighter?.['display_name'] ?? '').trim() ||
          `${person?.['given_name'] ?? ''} ${person?.['family_name'] ?? ''}`.trim() ||
          String(registration['id']);
        return {
          leagueId,
          tournamentId: String(tournament['id']),
          eventId: String(tournament['event_id']),
          fighterId: (registration['fighter_id'] as string | null) ?? null,
          fighterName: name,
          clubName: null,
          clubCity: null,
          weapon: (tournament['weapon'] as string | null) ?? null,
          category: (tournament['category'] as string | null) ?? null,
          finalRank: index + 1,
          doubleHits: doubleHits.get(String(registration['id'])) ?? 0,
        };
      });
  }

  private doubleHitsByRegistration(matches: Row[], exchanges: Row[]): Map<string, number> {
    const matchById = new Map(matches.map((match) => [String(match['id']), match]));
    const result = new Map<string, number>();
    for (const exchange of exchanges) {
      if (exchange['type'] !== 'double' || exchange['voided']) continue;
      const match = matchById.get(String(exchange['match_id']));
      if (!match) continue;
      for (const key of ['red_registration_id', 'blue_registration_id']) {
        const registrationId = String(match[key] ?? '');
        if (registrationId) result.set(registrationId, (result.get(registrationId) ?? 0) + 1);
      }
    }
    return result;
  }

  private async replaceTournamentResults(
    leagueId: string,
    tournamentId: string,
    contributions: LeagueTournamentContribution[],
  ) {
    await this.supabase.service
      .from('league_tournament_results')
      .delete()
      .eq('league_id', leagueId)
      .eq('tournament_id', tournamentId);
    if (contributions.length === 0) return;
    const { error } = await this.supabase.service.from('league_tournament_results').insert(
      contributions.map((row) => ({
        league_id: row.leagueId,
        tournament_id: row.tournamentId,
        event_id: row.eventId,
        fighter_id: row.fighterId,
        ranking_group_key: row.rankingGroupKey,
        final_rank: row.finalRank,
        league_points: row.leaguePoints,
        medal: row.medal,
        double_hits: row.doubleHits,
      })),
    );
    if (error) throw new BadRequestException(error.message);
  }

  private async replaceRankings(leagueId: string, rankings: LeagueRankingRow[]) {
    await this.supabase.service.from('league_rankings').delete().eq('league_id', leagueId);
    if (rankings.length === 0) return;
    const { error } = await this.supabase.service.from('league_rankings').insert(
      rankings.map((row) => ({
        league_id: row.leagueId,
        ranking_group_key: row.rankingGroupKey,
        fighter_id: row.fighterId,
        rank: row.rank,
        total_points: row.totalPoints,
        participation_count: row.participationCount,
        medal_count: row.medalCount,
        double_hits_total: row.doubleHitsTotal,
        double_hit_average: String(row.doubleHitAverage),
        per_tournament: row.perTournament,
      })),
    );
    if (error) throw new BadRequestException(error.message);
  }

  private async getTournamentWithEvent(tournamentId: string): Promise<Row> {
    const { data, error } = await this.supabase.service
      .from('tournaments')
      .select('*, events(organization_id)')
      .eq('id', tournamentId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException(`Tournament ${tournamentId} not found`);
    const row = data as Row & { events?: Row | null };
    return { ...row, organization_id: row.events?.['organization_id'] };
  }

  private async getLeagueById(leagueId: string): Promise<Row> {
    const { data, error } = await this.supabase.service
      .from('leagues')
      .select('*')
      .eq('id', leagueId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException(`League ${leagueId} not found`);
    return data as Row;
  }

  private async assertCanManageLeague(leagueId: string, userId: string) {
    if (await this.isSuperAdmin(userId)) return;
    const { data: directRole } = await this.supabase.service
      .from('league_user_roles')
      .select('role')
      .eq('league_id', leagueId)
      .eq('user_id', userId)
      .in('role', ['admin', 'owner'])
      .maybeSingle();
    if (directRole) return;

    const orgMemberships = await this.listRows('organization_members', 'user_id', userId);
    const adminOrgIds = orgMemberships
      .filter((row) => ['admin', 'owner'].includes(String(row['role'])))
      .map((row) => String(row['organization_id']));
    if (adminOrgIds.length > 0) {
      const { data: orgRole } = await this.supabase.service
        .from('league_organization_roles')
        .select('id')
        .eq('league_id', leagueId)
        .in('organization_id', adminOrgIds)
        .in('role', ['admin', 'owner'])
        .maybeSingle();
      if (orgRole) return;
    }

    throw new ForbiddenException('League admin access required');
  }

  private async isSuperAdmin(userId: string): Promise<boolean> {
    if (!userId || userId === 'anonymous') return false;
    const { data } = await this.supabase.service
      .from('platform_roles')
      .select('role')
      .eq('user_id', userId)
      .eq('role', 'super_admin')
      .maybeSingle();
    return Boolean(data);
  }

  private async listMatchesForTournament(tournamentId: string): Promise<Row[]> {
    const { data, error } = await this.supabase.service
      .from('matches')
      .select('*, phases!inner(tournament_id)')
      .eq('phases.tournament_id', tournamentId);
    if (error) throw new BadRequestException(error.message);
    return (data ?? []) as Row[];
  }

  private async listRows(table: string, column: string, value: string): Promise<Row[]> {
    const { data, error } = await this.supabase.service.from(table).select('*').eq(column, value);
    if (error) throw new BadRequestException(error.message);
    return (data ?? []) as Row[];
  }

  private async listRowsIn(table: string, column: string, values: string[]): Promise<Row[]> {
    const { data, error } = await this.supabase.service.from(table).select('*').in(column, values);
    if (error) throw new BadRequestException(error.message);
    return (data ?? []) as Row[];
  }
}

function normalizeScoringConfig(input: unknown): LeagueScoringConfig {
  const source = (input ?? {}) as Partial<LeagueScoringConfig> & {
    scoringSystem?: LeagueScoringConfig['scoringSystem'];
    rankingDimensions?: LeagueScoringConfig['rankingDimensions'];
  };
  const scoringSystem = source.scoringSystem ?? DEFAULT_LEAGUE_SCORING_CONFIG.scoringSystem;
  const rankingDimensions =
    source.rankingDimensions ?? DEFAULT_LEAGUE_SCORING_CONFIG.rankingDimensions;
  const tieBreakers =
    source.tieBreakers && source.tieBreakers.length > 0
      ? source.tieBreakers
      : DEFAULT_LEAGUE_SCORING_CONFIG.tieBreakers;
  return {
    scoringSystem,
    rankingDimensions,
    customPointsByRank: source.customPointsByRank,
    tieBreakers,
  };
}

function csv(value: unknown): string {
  const raw = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
