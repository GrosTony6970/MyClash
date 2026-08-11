import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { asEventKind, countsTowardStats, toCsvCell } from '@myclash/types';
import { OrganizationsService } from '../organizations/organizations.service';
import { SupabaseService } from '../supabase/supabase.service';
import { hasPlatformTier } from '../../common/auth/platform-role';
import {
  DEFAULT_LEAGUE_SCORING_CONFIG,
  type LeagueRankingRow,
  type LeagueScoringConfig,
  type LeagueTournamentContribution,
  type TournamentContributionInput,
} from './league.types';
import { LeagueScoringService } from './league-scoring.service';
import {
  computeLeagueFreshness,
  type LeagueFreshnessReport,
  type LinkedTournamentChange,
} from './league-freshness';
import { attachDecidingTiebreaks } from './league-standings-rows';
import { aggregateClubStandings } from './league-club-standings';
// Value import (NOT `import type`) — DI-injected, so the runtime needs the
// class metadata preserved.
import { TournamentPlacementService } from '../tournament-placement/tournament-placement.service';
import type {
  AddLeagueOrganizationRoleDto,
  AddLeagueUserRoleDto,
  CreateLeagueDto,
  UpdateLeagueDto,
} from './dto/leagues.dto';

type Row = Record<string, unknown>;

const LEAGUE_LOGO_BUCKET = 'event-assets';
const LEAGUE_LOGO_MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_LEAGUE_LOGO_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

export interface LeagueLogoUpload {
  buffer: Buffer;
  filename: string;
  mimetype: string;
}

@Injectable()
export class LeaguesService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly orgs: OrganizationsService,
    private readonly scoring: LeagueScoringService,
    // Optional so existing unit tests that construct LeaguesService with three
    // args (none of which exercise recompute) keep working; provided by
    // LeaguesModule in production. Recompute contributes nothing without it.
    private readonly placement?: TournamentPlacementService,
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
    return this.enrichPublicLeaguesWithGroups((data ?? []) as Row[]);
  }

  /**
   * Project per-league counts + a groups breakdown onto every public
   * league row so the home page Leagues tab can render its summary
   * table in one round-trip:
   *   - event_count       → distinct event ids reached via approved
   *                         tournament-links
   *   - tournament_count  → total approved tournament-links
   *   - groups            → [{ id, name, tournament_count }] for each
   *                         league_groups row, with each group's
   *                         approved-link count attached
   * Two parallel batch SELECTs (groups, approved links with the
   * tournaments(event_id) embed). Aggregation happens in TS to stay
   * away from PostgREST aggregation quirks. Mirrors the admin-side
   * enrichLeaguesWithCounts pattern but trades fighter_count for
   * the groups breakdown.
   */
  private async enrichPublicLeaguesWithGroups(leagues: Row[]): Promise<Row[]> {
    if (leagues.length === 0) return leagues;
    const leagueIds = leagues.map((l) => String(l['id']));
    const [groupsRes, linksRes] = await Promise.all([
      this.supabase.service
        .from('league_groups')
        .select('id, league_id, name')
        .in('league_id', leagueIds)
        .order('sort_order', { ascending: true }),
      this.supabase.service
        .from('league_tournament_links')
        .select('league_id, group_id, tournaments(event_id)')
        .in('league_id', leagueIds)
        .eq('status', 'approved'),
    ]);

    type GroupRow = { id: string; league_id: string; name: string };
    type LinkRow = {
      league_id: string;
      group_id: string | null;
      tournaments?: { event_id: string | null } | { event_id: string | null }[] | null;
    };

    // group_id → tournament_count
    const tournamentCountByGroup = new Map<string, number>();
    const tournamentCountByLeague = new Map<string, number>();
    const eventsPerLeague = new Map<string, Set<string>>();
    for (const link of (linksRes.data ?? []) as LinkRow[]) {
      tournamentCountByLeague.set(
        link.league_id,
        (tournamentCountByLeague.get(link.league_id) ?? 0) + 1,
      );
      if (link.group_id) {
        tournamentCountByGroup.set(
          link.group_id,
          (tournamentCountByGroup.get(link.group_id) ?? 0) + 1,
        );
      }
      const embed = link.tournaments;
      const eventId = Array.isArray(embed) ? embed[0]?.event_id : embed?.event_id;
      if (eventId) {
        if (!eventsPerLeague.has(link.league_id)) eventsPerLeague.set(link.league_id, new Set());
        eventsPerLeague.get(link.league_id)!.add(eventId);
      }
    }

    // league_id → ordered groups list with per-group tournament_count
    const groupsByLeague = new Map<
      string,
      Array<{ id: string; name: string; tournament_count: number }>
    >();
    for (const g of (groupsRes.data ?? []) as GroupRow[]) {
      if (!groupsByLeague.has(g.league_id)) groupsByLeague.set(g.league_id, []);
      groupsByLeague.get(g.league_id)!.push({
        id: g.id,
        name: g.name,
        tournament_count: tournamentCountByGroup.get(g.id) ?? 0,
      });
    }

    return leagues.map((row) => {
      const id = String(row['id']);
      return {
        ...row,
        event_count: eventsPerLeague.get(id)?.size ?? 0,
        tournament_count: tournamentCountByLeague.get(id) ?? 0,
        groups: groupsByLeague.get(id) ?? [],
      };
    });
  }

  /**
   * Leagues an organizer can request to attach a tournament to.
   * Unlike listPublic (which gates on visibility + published status),
   * this surface returns every non-archived league so organizers can
   * also see drafts they may have permission to attach to. The
   * attach POST still enforces league + org permissions on its side.
   */
  async listAttachable() {
    const { data, error } = await this.supabase.service
      .from('leagues')
      .select('*')
      .in('status', ['draft', 'published'])
      .order('season_year', { ascending: false });
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
    if (await this.isPlatformStaffAdmin(userId)) {
      const { data, error } = await this.supabase.service
        .from('leagues')
        .select('*')
        .order('season_year', { ascending: false });
      if (error) throw new BadRequestException(error.message);
      const enriched = await this.enrichLeaguesWithCounts((data ?? []) as Row[]);
      return enriched.map((league) => ({
        ...league,
        access: { direct_role: null, organizations: [], super_admin: true },
      }));
    }

    const [userRoles, orgMemberships] = await Promise.all([
      this.listRows('league_user_roles', 'user_id', userId),
      this.listRows('organization_members', 'user_id', userId),
    ]);
    const leagueIds = new Set(userRoles.map((row) => String(row['league_id'])));
    // Why each league is listed, so the personal workspace can badge a direct
    // grant apart from one inherited through an organization. The nav entry is
    // gated on direct grants only while this list is the full union, and the
    // badge is what keeps that difference legible rather than looking like a bug.
    const directRoleByLeague = new Map<string, string>();
    for (const row of userRoles) {
      directRoleByLeague.set(String(row['league_id']), String(row['role']));
    }
    const orgIds = orgMemberships
      .filter((row) => ['admin', 'owner'].includes(String(row['role'])))
      .map((row) => String(row['organization_id']));
    const orgRolesByLeague = new Map<string, Array<{ id: string; name: string; role: string }>>();
    if (orgIds.length > 0) {
      const { data } = await this.supabase.service
        .from('league_organization_roles')
        .select('league_id, organization_id, role')
        .in('organization_id', orgIds)
        .in('role', ['admin', 'owner']);
      const rows = (data ?? []) as Row[];
      for (const row of rows) leagueIds.add(String(row['league_id']));

      // Names, never ids — the cards render "Via {organization}".
      const nameById = new Map<string, string>();
      const referencedOrgIds = [...new Set(rows.map((row) => String(row['organization_id'])))];
      if (referencedOrgIds.length > 0) {
        const { data: orgs } = await this.supabase.service
          .from('organizations')
          .select('id, name')
          .in('id', referencedOrgIds);
        for (const org of (orgs ?? []) as Row[]) {
          nameById.set(String(org['id']), String(org['name'] ?? ''));
        }
      }
      for (const row of rows) {
        const leagueId = String(row['league_id']);
        const organizationId = String(row['organization_id']);
        const list = orgRolesByLeague.get(leagueId) ?? [];
        list.push({
          id: organizationId,
          name: nameById.get(organizationId) ?? '',
          role: String(row['role']),
        });
        orgRolesByLeague.set(leagueId, list);
      }
    }

    if (leagueIds.size === 0) return [];
    const { data, error } = await this.supabase.service
      .from('leagues')
      .select('*')
      .in('id', [...leagueIds])
      .order('season_year', { ascending: false });
    if (error) throw new BadRequestException(error.message);
    const enriched = await this.enrichLeaguesWithCounts((data ?? []) as Row[]);
    return enriched.map((league) => {
      const id = String((league as Row)['id']);
      return {
        ...league,
        access: {
          direct_role: directRoleByLeague.get(id) ?? null,
          organizations: orgRolesByLeague.get(id) ?? [],
          super_admin: false,
        },
      };
    });
  }

  /**
   * One league the caller manages. The org workspace historically fetched the
   * whole manageable list and .find()-ed it, purely because this endpoint did
   * not exist; the personal workspace reads it directly instead.
   */
  async getManageable(leagueId: string, userId: string) {
    await this.assertCanManageLeague(leagueId, userId);
    const { data, error } = await this.supabase.service
      .from('leagues')
      .select('*')
      .eq('id', leagueId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException(`League ${leagueId} not found`);
    const [enriched] = await this.enrichLeaguesWithCounts([data as Row]);
    return enriched;
  }

  /**
   * Org-scoped variant of listManageable: leagues a single organization manages
   * (holds an admin/owner role on via league_organization_roles). Backs the
   * organizer workspace "Leagues → Manage" tab. The caller must be an admin/owner
   * of the organization; each returned league carries the org's role on it.
   */
  async listManageableByOrg(organizationId: string, userId: string) {
    await this.orgs.assertOrgRole(organizationId, userId, 'admin');
    const { data: roleRows, error: roleErr } = await this.supabase.service
      .from('league_organization_roles')
      .select('league_id, role')
      .eq('organization_id', organizationId)
      .in('role', ['admin', 'owner']);
    if (roleErr) throw new BadRequestException(roleErr.message);
    const roleByLeague = new Map<string, string>();
    for (const row of (roleRows ?? []) as Row[]) {
      roleByLeague.set(String(row['league_id']), String(row['role']));
    }
    if (roleByLeague.size === 0) return [];
    const { data, error } = await this.supabase.service
      .from('leagues')
      .select('*')
      .in('id', [...roleByLeague.keys()])
      .order('season_year', { ascending: false });
    if (error) throw new BadRequestException(error.message);
    const enriched = await this.enrichLeaguesWithCounts((data ?? []) as Row[]);
    return enriched.map((league) => ({
      ...league,
      org_role: roleByLeague.get(String(league['id'])) ?? null,
    }));
  }

  /**
   * Every league this organization belongs to, at ANY role (member/admin/owner),
   * sourced from league_organization_roles with NO role filter. Backs the
   * organizer workspace "Leagues → Membership" tab so a member-role org — or one
   * added directly by a super-admin with no request row — can still see the
   * leagues it belongs to (the reported gap). The caller must be an admin/owner
   * of the organization; each returned league carries the org's role + join date.
   */
  async listOrganizationMemberships(organizationId: string, userId: string) {
    await this.orgs.assertOrgRole(organizationId, userId, 'admin');
    const { data: roleRows, error: roleErr } = await this.supabase.service
      .from('league_organization_roles')
      .select('league_id, role, created_at')
      .eq('organization_id', organizationId);
    if (roleErr) throw new BadRequestException(roleErr.message);
    const roleByLeague = new Map<string, string>();
    const joinedAtByLeague = new Map<string, string>();
    for (const row of (roleRows ?? []) as Row[]) {
      const leagueId = String(row['league_id']);
      roleByLeague.set(leagueId, String(row['role']));
      if (row['created_at'] != null) joinedAtByLeague.set(leagueId, String(row['created_at']));
    }
    if (roleByLeague.size === 0) return [];
    const { data, error } = await this.supabase.service
      .from('leagues')
      .select('*')
      .in('id', [...roleByLeague.keys()])
      .order('season_year', { ascending: false });
    if (error) throw new BadRequestException(error.message);
    const enriched = await this.enrichLeaguesWithCounts((data ?? []) as Row[]);
    return enriched.map((league) => ({
      ...league,
      org_role: roleByLeague.get(String(league['id'])) ?? null,
      joined_at: joinedAtByLeague.get(String(league['id'])) ?? null,
    }));
  }

  /**
   * Project four per-league counts onto each row so the Ranking tab
   * can render its summary table in a single round-trip:
   *   - group_count       → league_groups rows for this league
   *   - tournament_count  → approved tournament-link rows
   *   - event_count       → distinct event ids the approved tournaments
   *                         belong to
   *   - fighter_count     → distinct fighter ids that appear in
   *                         league_rankings
   * Three parallel batch SELECTs; aggregation happens in TS to avoid
   * PostgREST aggregation quirks.
   */
  private async enrichLeaguesWithCounts(leagues: Row[]): Promise<Row[]> {
    if (leagues.length === 0) return leagues;
    const leagueIds = leagues.map((l) => String(l['id']));
    const [groupsRes, linksRes, rankingsRes] = await Promise.all([
      this.supabase.service.from('league_groups').select('league_id').in('league_id', leagueIds),
      this.supabase.service
        .from('league_tournament_links')
        .select('league_id, tournaments(event_id)')
        .in('league_id', leagueIds)
        .eq('status', 'approved'),
      this.supabase.service
        .from('league_rankings')
        .select('league_id, fighter_id')
        .in('league_id', leagueIds),
    ]);

    type LinkRow = {
      league_id: string;
      tournaments?: { event_id: string | null } | { event_id: string | null }[] | null;
    };

    const groupCount = new Map<string, number>();
    for (const row of (groupsRes.data ?? []) as Row[]) {
      const id = String(row['league_id']);
      groupCount.set(id, (groupCount.get(id) ?? 0) + 1);
    }
    const tournamentCount = new Map<string, number>();
    const eventsPerLeague = new Map<string, Set<string>>();
    for (const row of (linksRes.data ?? []) as LinkRow[]) {
      const id = row.league_id;
      tournamentCount.set(id, (tournamentCount.get(id) ?? 0) + 1);
      const embed = row.tournaments;
      const eventId = Array.isArray(embed) ? embed[0]?.event_id : embed?.event_id;
      if (eventId) {
        if (!eventsPerLeague.has(id)) eventsPerLeague.set(id, new Set());
        eventsPerLeague.get(id)!.add(eventId);
      }
    }
    const fightersPerLeague = new Map<string, Set<string>>();
    for (const row of (rankingsRes.data ?? []) as Array<{
      league_id: string;
      fighter_id: string;
    }>) {
      if (!fightersPerLeague.has(row.league_id)) {
        fightersPerLeague.set(row.league_id, new Set());
      }
      fightersPerLeague.get(row.league_id)!.add(row.fighter_id);
    }

    return leagues.map((row) => {
      const id = String(row['id']);
      return {
        ...row,
        group_count: groupCount.get(id) ?? 0,
        tournament_count: tournamentCount.get(id) ?? 0,
        event_count: eventsPerLeague.get(id)?.size ?? 0,
        fighter_count: fightersPerLeague.get(id)?.size ?? 0,
      };
    });
  }

  async create(dto: CreateLeagueDto, userId: string) {
    const isSuperAdmin = await this.isPlatformStaffAdmin(userId);
    if (dto.ownerOrganizationId) {
      if (!isSuperAdmin) {
        await this.orgs.assertOrgRole(dto.ownerOrganizationId, userId, 'admin');
      }
    } else if (!isSuperAdmin) {
      throw new ForbiddenException('Super admin access required');
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
    if (dto.status !== undefined) {
      updates['status'] = dto.status;
      // published <=> publicly visible. Derived here, never accepted from the
      // caller, so no update path can desync the pair that the public reads
      // AND-gate (listPublic / getPublicBySlug / standings).
      updates['public_visibility'] = dto.status === 'published';
    }
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
    // Belt-and-braces: the FE filters the platform org out of the picker, but a
    // bypassed call must still be rejected. The org's `is_platform` flag is
    // the canonical source; we also defend against legacy rows where the flag
    // wasn't backfilled by matching the well-known `myclash-hq` slug.
    const { data: org, error: orgError } = await this.supabase.service
      .from('organizations')
      .select('id, slug, is_platform')
      .eq('id', dto.organizationId)
      .maybeSingle();
    if (orgError) throw new BadRequestException(orgError.message);
    if (!org) throw new BadRequestException('Organization not found.');
    const platformOrg =
      (org as { is_platform?: boolean; slug?: string }).is_platform === true ||
      (org as { slug?: string }).slug === 'myclash-hq';
    if (platformOrg) {
      throw new BadRequestException(
        'The MyClash platform organisation cannot be added to a league.',
      );
    }

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

  // ── Logo upload + delete ────────────────────────────────────────────────────

  async uploadLogo(
    leagueId: string,
    file: LeagueLogoUpload,
    userId: string,
  ): Promise<{ url: string }> {
    await this.assertCanManageLeague(leagueId, userId);

    if (!file.buffer.length) throw new BadRequestException('No logo file uploaded.');
    if (file.buffer.length > LEAGUE_LOGO_MAX_BYTES) {
      throw new BadRequestException('Logo upload exceeds the 10 MB size limit.');
    }
    if (!ALLOWED_LEAGUE_LOGO_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException('Logo upload must be a PNG, JPEG, or WebP image.');
    }

    await this.ensureLogoBucket();
    const extension = this.extensionFor(file.mimetype);
    const safeBase = file.filename
      .toLowerCase()
      .replace(/\.[^.]+$/u, '')
      .replace(/[^a-z0-9-]+/gu, '-')
      .replace(/^-+|-+$/gu, '')
      .slice(0, 60);
    const path = `leagues/${leagueId}/logo-${Date.now()}-${safeBase || 'image'}.${extension}`;

    const { error } = await this.supabase.service.storage
      .from(LEAGUE_LOGO_BUCKET)
      .upload(path, file.buffer, {
        contentType: file.mimetype,
        upsert: true,
      });
    if (error) throw new BadRequestException(error.message);

    const { data } = this.supabase.service.storage.from(LEAGUE_LOGO_BUCKET).getPublicUrl(path);
    const { error: updateError } = await this.supabase.service
      .from('leagues')
      .update({ logo_url: data.publicUrl, updated_at: new Date().toISOString() })
      .eq('id', leagueId);
    if (updateError) throw new BadRequestException(updateError.message);
    return { url: data.publicUrl };
  }

  async deleteLogo(leagueId: string, userId: string): Promise<{ id: string; logo_url: null }> {
    await this.assertCanManageLeague(leagueId, userId);
    const { data: league, error: lookupError } = await this.supabase.service
      .from('leagues')
      .select('id, logo_url')
      .eq('id', leagueId)
      .maybeSingle();
    if (lookupError) throw new BadRequestException(lookupError.message);
    if (!league) throw new NotFoundException(`League ${leagueId} not found`);

    const current = (league as { id: string; logo_url: string | null }).logo_url;
    if (!current) return { id: leagueId, logo_url: null };

    const prefix = `leagues/${leagueId}`;
    const bucket = this.supabase.service.storage.from(LEAGUE_LOGO_BUCKET);
    const { data: objects, error: listError } = await bucket.list(prefix);
    if (listError && !/not found/iu.test(listError.message)) {
      throw new BadRequestException(listError.message);
    }
    const keys = (objects ?? [])
      .map((obj) => (obj && typeof obj === 'object' ? (obj as { name?: string }).name : undefined))
      .filter((name): name is string => typeof name === 'string' && name.length > 0)
      .map((name) => `${prefix}/${name}`);
    if (keys.length > 0) {
      const { error: removeError } = await bucket.remove(keys);
      if (removeError && !/not found/iu.test(removeError.message)) {
        throw new BadRequestException(removeError.message);
      }
    }

    const { error: updateError } = await this.supabase.service
      .from('leagues')
      .update({ logo_url: null, updated_at: new Date().toISOString() })
      .eq('id', leagueId);
    if (updateError) throw new BadRequestException(updateError.message);
    return { id: leagueId, logo_url: null };
  }

  private extensionFor(mimetype: string): 'png' | 'jpg' | 'webp' {
    if (mimetype === 'image/png') return 'png';
    if (mimetype === 'image/webp') return 'webp';
    return 'jpg';
  }

  private async ensureLogoBucket(): Promise<void> {
    const storage = this.supabase.service.storage;
    const { data, error } = await storage.getBucket(LEAGUE_LOGO_BUCKET);
    if (data && !error) return;
    const created = await storage.createBucket(LEAGUE_LOGO_BUCKET, {
      public: true,
      fileSizeLimit: LEAGUE_LOGO_MAX_BYTES,
      allowedMimeTypes: Array.from(ALLOWED_LEAGUE_LOGO_MIME_TYPES),
    });
    if (created.error && !/already exists/iu.test(created.error.message)) {
      throw new BadRequestException(created.error.message);
    }
  }

  // ── Assignment list / remove ────────────────────────────────────────────────

  async listUserRoles(leagueId: string, userId: string) {
    await this.assertCanManageLeague(leagueId, userId);
    const { data, error } = await this.supabase.service
      .from('league_user_roles')
      .select('user_id, role, created_at')
      .eq('league_id', leagueId)
      .order('created_at', { ascending: true });
    if (error) throw new BadRequestException(error.message);
    const rows = (data ?? []) as Array<Record<string, unknown>>;

    const out: Array<{
      userId: string;
      role: string;
      displayName: string | null;
      email: string | null;
      organizations: Array<{ id: string; name: string; slug: string; role: string }>;
    }> = [];

    for (const row of rows) {
      const memberUserId = row['user_id'] as string;
      const authRes = await this.supabase.getAuthAdminUser(memberUserId);
      const authUser = authRes.ok && authRes.data ? authRes.data : null;
      const displayName =
        typeof authUser?.user_metadata?.['display_name'] === 'string'
          ? (authUser.user_metadata['display_name'] as string).trim() || null
          : null;
      const email = authUser?.email ?? null;

      const { data: memberships } = await this.supabase.service
        .from('organization_members')
        .select('role, organizations(id, name, slug)')
        .eq('user_id', memberUserId);
      const orgs = ((memberships ?? []) as Array<Record<string, unknown>>)
        .map((m) => {
          const org = m['organizations'] as { id?: string; name?: string; slug?: string } | null;
          if (!org?.id) return null;
          return {
            id: org.id,
            name: org.name ?? '',
            slug: org.slug ?? '',
            role: (m['role'] as string) ?? '',
          };
        })
        .filter(
          (entry): entry is { id: string; name: string; slug: string; role: string } =>
            entry !== null,
        );

      out.push({
        userId: memberUserId,
        role: (row['role'] as string) ?? 'admin',
        displayName,
        email,
        organizations: orgs,
      });
    }
    return out;
  }

  async removeUserRole(leagueId: string, targetUserId: string, userId: string) {
    await this.assertCanManageLeague(leagueId, userId);

    // The roles tab can remove individual admins but cannot add them — that
    // stays super-admin only — so both of these are unrecoverable through the
    // UI: dropping your own last route in, and draining the league's managers.
    if (
      targetUserId === userId &&
      !(await this.isPlatformStaffAdmin(userId)) &&
      !(await this.hasOrgManagePath(leagueId, userId))
    ) {
      throw new BadRequestException(
        'You cannot remove your own league access. Ask a super admin to do it.',
      );
    }
    if (!(await this.wouldRetainAManager(leagueId, targetUserId))) {
      throw new BadRequestException('A league must keep at least one admin or owner.');
    }

    const { data, error } = await this.supabase.service
      .from('league_user_roles')
      .delete()
      .eq('league_id', leagueId)
      .eq('user_id', targetUserId)
      .select('user_id')
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('League user role not found');
    return { leagueId, userId: targetUserId };
  }

  async listOrganizationRoles(leagueId: string, userId: string) {
    await this.assertCanManageLeague(leagueId, userId);
    const { data, error } = await this.supabase.service
      .from('league_organization_roles')
      .select('organization_id, role, created_at, organizations(id, name, slug)')
      .eq('league_id', leagueId)
      .order('created_at', { ascending: true });
    if (error) throw new BadRequestException(error.message);
    return ((data ?? []) as Array<Record<string, unknown>>).map((row) => {
      const org = row['organizations'] as { id?: string; name?: string; slug?: string } | null;
      return {
        organizationId: row['organization_id'] as string,
        role: (row['role'] as string) ?? 'member',
        name: org?.name ?? '',
        slug: org?.slug ?? '',
      };
    });
  }

  async removeOrganizationRole(leagueId: string, organizationId: string, userId: string) {
    await this.assertCanManageLeague(leagueId, userId);
    const { data, error } = await this.supabase.service
      .from('league_organization_roles')
      .delete()
      .eq('league_id', leagueId)
      .eq('organization_id', organizationId)
      .select('organization_id')
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('League organization role not found');
    return { leagueId, organizationId };
  }

  async requestTournamentLink(
    leagueId: string,
    tournamentId: string,
    userId: string,
    groupId?: string | null,
  ) {
    const tournament = await this.getTournamentWithEvent(tournamentId);
    await this.orgs.assertOrgRole(String(tournament['organization_id']), userId, 'admin');
    if (groupId) await this.assertGroupBelongsToLeague(groupId, leagueId);
    const { data, error } = await this.supabase.service
      .from('league_tournament_links')
      .upsert(
        {
          league_id: leagueId,
          tournament_id: tournamentId,
          status: 'requested',
          requested_by_user_id: userId,
          group_id: groupId ?? null,
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
      .select(
        '*, tournaments(id, name, weapon, status, events(id, name, start_date)), league_groups(id, name)',
      )
      .eq('league_id', leagueId)
      .order('created_at', { ascending: false });
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  /**
   * Filtered view of tournament-attach requests for a league. Used by the
   * shared LeagueRequestsPanel rendered in the editor + standalone route.
   * Filters out `'removed'` rows (those are unlinked tournaments, not
   * pending review). When `status` is omitted, returns all non-removed
   * rows so the panel can group by status client-side.
   */
  async listLeagueRequests(
    leagueId: string,
    userId: string,
    status?: 'requested' | 'approved' | 'rejected',
  ) {
    await this.assertCanManageLeague(leagueId, userId);
    let q = this.supabase.service
      .from('league_tournament_links')
      .select(
        '*, tournaments(id, name, weapon, status, events(id, name, start_date, organization_id, organizations(id, name)))',
      )
      .eq('league_id', leagueId)
      .neq('status', 'removed')
      .order('created_at', { ascending: false });
    if (status) q = q.eq('status', status) as typeof q;
    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  // ── Groups ────────────────────────────────────────────────────────────────

  async listGroups(leagueId: string) {
    const { data, error } = await this.supabase.service
      .from('league_groups')
      .select('*')
      .eq('league_id', leagueId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async createGroup(leagueId: string, dto: { name: string; sortOrder?: number }, userId: string) {
    await this.assertCanManageLeague(leagueId, userId);
    const name = dto.name.trim();
    if (!name) throw new BadRequestException('Group name is required');
    const { data, error } = await this.supabase.service
      .from('league_groups')
      .insert({
        league_id: leagueId,
        name,
        sort_order: dto.sortOrder ?? 0,
      })
      .select('*')
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async updateGroup(groupId: string, dto: { name?: string; sortOrder?: number }, userId: string) {
    const { data: existing } = await this.supabase.service
      .from('league_groups')
      .select('league_id')
      .eq('id', groupId)
      .maybeSingle();
    if (!existing) throw new NotFoundException(`League group ${groupId} not found`);
    await this.assertCanManageLeague(String((existing as Row)['league_id']), userId);

    const updates: Record<string, unknown> = {};
    if (dto.name !== undefined) {
      const trimmed = dto.name.trim();
      if (!trimmed) throw new BadRequestException('Group name cannot be empty');
      updates['name'] = trimmed;
    }
    if (dto.sortOrder !== undefined) updates['sort_order'] = dto.sortOrder;
    if (Object.keys(updates).length === 0) return existing;

    const { data, error } = await this.supabase.service
      .from('league_groups')
      .update(updates)
      .eq('id', groupId)
      .select('*')
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async deleteGroup(groupId: string, userId: string) {
    const { data: existing } = await this.supabase.service
      .from('league_groups')
      .select('league_id')
      .eq('id', groupId)
      .maybeSingle();
    if (!existing) throw new NotFoundException(`League group ${groupId} not found`);
    await this.assertCanManageLeague(String((existing as Row)['league_id']), userId);
    const { error } = await this.supabase.service.from('league_groups').delete().eq('id', groupId);
    if (error) throw new BadRequestException(error.message);
    // Links referencing this group automatically have group_id set to NULL
    // by the ON DELETE SET NULL FK.
  }

  private async assertGroupBelongsToLeague(groupId: string, leagueId: string) {
    const { data } = await this.supabase.service
      .from('league_groups')
      .select('league_id')
      .eq('id', groupId)
      .maybeSingle();
    if (!data || String((data as Row)['league_id']) !== leagueId) {
      throw new BadRequestException(`Group ${groupId} does not belong to league ${leagueId}`);
    }
  }

  async reviewTournamentLink(
    linkId: string,
    update: { status?: 'approved' | 'rejected' | 'removed'; groupId?: string | null },
    userId: string,
  ) {
    const { data: link } = await this.supabase.service
      .from('league_tournament_links')
      .select('*')
      .eq('id', linkId)
      .maybeSingle();
    if (!link) throw new NotFoundException(`League tournament link ${linkId} not found`);
    const leagueId = String((link as Row)['league_id']);
    await this.assertCanManageLeague(leagueId, userId);

    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (update.status !== undefined) {
      updates['status'] = update.status;
      updates['reviewed_by_user_id'] = userId;
      updates['reviewed_at'] = new Date().toISOString();
    }
    if (update.groupId !== undefined) {
      if (update.groupId !== null) {
        await this.assertGroupBelongsToLeague(update.groupId, leagueId);
      }
      updates['group_id'] = update.groupId;
    }

    const { data, error } = await this.supabase.service
      .from('league_tournament_links')
      .update(updates)
      .eq('id', linkId)
      .select('*')
      .single();
    if (error) throw new BadRequestException(error.message);

    // Auto-grant the requesting org a `member` role on the league when
    // the tournament link is approved. The org gains read access to
    // league metadata, private results/rankings, the roster, and the
    // tournament-request history — see migration 0015's RLS rules.
    // Uses `ignoreDuplicates: true` so an org that's already a member /
    // admin / owner keeps its existing (potentially higher) role —
    // re-approval must never demote an admin back to member.
    if (update.status === 'approved') {
      const tournamentId = String((link as Row)['tournament_id'] ?? '');
      if (tournamentId) {
        const { data: tournament } = await this.supabase.service
          .from('tournaments')
          .select('events ( organization_id )')
          .eq('id', tournamentId)
          .maybeSingle();
        const orgId = (tournament as { events?: { organization_id?: string } } | null)?.events
          ?.organization_id;
        if (orgId) {
          await this.supabase.service
            .from('league_organization_roles')
            .upsert(
              { league_id: leagueId, organization_id: orgId, role: 'member' },
              { onConflict: 'league_id,organization_id', ignoreDuplicates: true },
            );
        }
      }
    }

    // A link that LEAVES `approved` has to take its contributions with it.
    //
    // Nothing else can do it afterwards: `recomputeForEvent` only walks approved
    // links, so the moment the status flips, that tournament can no longer clean
    // up its own `league_tournament_results` rows — and `recomputeLeagueRankings`
    // re-ranks from whatever those rows still hold. Without this, removing an
    // event from a season left every fighter still carrying its points, with no
    // error and nothing on screen to suggest the table had stopped being true.
    //
    // The rows go regardless of the freeze; only the RE-RANK is withheld from a
    // finalized season, whose published table must not move under it. Reopening
    // then recomputes without the removed tournament, which is the right answer.
    if (update.status !== undefined && update.status !== 'approved') {
      const tournamentId = String((link as Row)['tournament_id'] ?? '');
      if (tournamentId) {
        const { error: resultsError } = await this.supabase.service
          .from('league_tournament_results')
          .delete()
          .eq('league_id', leagueId)
          .eq('tournament_id', tournamentId);
        if (resultsError) throw new BadRequestException(resultsError.message);
        const league = await this.getLeagueById(leagueId);
        if (!league['finalized_at']) await this.recomputeLeagueRankings(leagueId);
      }
    }

    return data;
  }

  async removeEventTournamentLinks(
    leagueId: string,
    eventId: string,
    userId: string,
  ): Promise<void> {
    await this.assertCanManageLeague(leagueId, userId);
    const { data: links } = await this.supabase.service
      .from('league_tournament_links')
      .select('id, tournaments!inner(event_id)')
      .eq('league_id', leagueId)
      .eq('tournaments.event_id', eventId)
      .neq('status', 'removed');
    for (const link of (links ?? []) as Row[]) {
      await this.reviewTournamentLink(String(link['id']), { status: 'removed' }, userId);
    }
  }

  // ── Event-side leagues views (organizer surface) ──────────────────────────

  /**
   * Resolve the event's owning org and assert the caller has at least
   * the editor role there. Mirrors the staff module's
   * `assertCanManageEventStaff` pattern — we reuse the canonical
   * org-role hierarchy from OrganizationsService rather than rolling
   * a new one.
   */
  private async assertCanManageEvent(eventId: string, userId: string): Promise<string> {
    const { data: event, error } = await this.supabase.service
      .from('events')
      .select('id, organization_id')
      .eq('id', eventId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!event) throw new NotFoundException(`Event ${eventId} not found`);
    const organizationId = String((event as Row)['organization_id']);
    await this.orgs.assertOrgRole(organizationId, userId, 'editor');
    return organizationId;
  }

  /**
   * Lists every non-removed tournament-attach link for an event,
   * with league + group + tournament joined inline so the organizer-
   * side `/events/:id/leagues` page can render both the "Requests"
   * tab (any status) and the "Memberships" tab (status='approved'
   * filtered client-side) off a single fetch.
   */
  async listEventLeagueAttachments(eventId: string, userId: string) {
    await this.assertCanManageEvent(eventId, userId);
    const { data, error } = await this.supabase.service
      .from('league_tournament_links')
      .select(
        '*, leagues(id, name, slug, season_year, scoring_system, scoring_config), league_groups(id, name), tournaments!inner(id, name, event_id)',
      )
      .eq('tournaments.event_id', eventId)
      .neq('status', 'removed')
      .order('created_at', { ascending: false });
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  /**
   * Operator self-detach. Flips the link to status='removed' so the
   * organizer can withdraw a pending request or leave an approved
   * attachment without going through the league admin. Auth: the
   * link's tournament must belong to the `:eventId` in the URL AND
   * the caller must be at least editor on the event's org.
   *
   * Defence in depth: we resolve the link's tournament → event →
   * org via a single PostgREST join, then assert both that the
   * tournament's event matches the URL's `:eventId` (prevents id
   * substitution) and that the caller can manage that event.
   */
  async selfDetachTournamentLink(eventId: string, linkId: string, userId: string): Promise<void> {
    const { data: link, error } = await this.supabase.service
      .from('league_tournament_links')
      .select('id, tournaments!inner(id, event_id, events(organization_id))')
      .eq('id', linkId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!link) throw new NotFoundException(`Link ${linkId} not found`);

    const tournament = (link as Row)['tournaments'] as Row | null;
    const linkEventId = tournament ? String(tournament['event_id']) : '';
    if (linkEventId !== eventId) {
      throw new NotFoundException(`Link ${linkId} does not belong to event ${eventId}`);
    }
    const eventRow = tournament ? ((tournament['events'] as Row | null) ?? null) : null;
    const organizationId = eventRow ? String(eventRow['organization_id']) : '';
    await this.orgs.assertOrgRole(organizationId, userId, 'editor');

    const { error: updateErr } = await this.supabase.service
      .from('league_tournament_links')
      .update({
        status: 'removed',
        reviewed_by_user_id: userId,
        reviewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', linkId);
    if (updateErr) throw new BadRequestException(updateErr.message);
  }

  /**
   * Every tournament belonging to any of this organization's events, flattened
   * across events. Powers the org-hub "Attach a tournament" picker, which — now
   * that tournament attachment is merged into the org Leagues hub — has no single
   * event context to scope to. Auth: editor+ on the org (mirrors the event-side
   * assertCanManageEvent editor bar). Each row carries its event so the picker
   * can group tournaments by event.
   */
  async listOrganizationTournaments(organizationId: string, userId: string) {
    await this.orgs.assertOrgRole(organizationId, userId, 'editor');
    const { data, error } = await this.supabase.service
      .from('tournaments')
      .select('id, name, weapon, event_id, events!inner(id, name, organization_id)')
      .eq('events.organization_id', organizationId)
      .order('name', { ascending: true });
    if (error) throw new BadRequestException(error.message);
    return ((data ?? []) as Row[]).map((row) => {
      const event = (row['events'] as Row | null) ?? null;
      return {
        id: row['id'],
        name: row['name'],
        weapon: row['weapon'] ?? null,
        event_id: row['event_id'],
        event_name: event ? event['name'] : null,
      };
    });
  }

  /**
   * Org-scoped variant of listEventLeagueAttachments: every non-removed
   * tournament-attach link whose tournament belongs to one of this org's events,
   * across all events. Powers the org-hub nested "Tournaments attached to this
   * league" section. Pass `leagueId` to lazily fetch a single league's slice on
   * expand. Each row carries tournaments.event_id so the UI can call the
   * event-scoped self-detach route. Auth: editor+ on the org.
   */
  async listOrganizationLeagueAttachments(
    organizationId: string,
    userId: string,
    leagueId?: string,
  ) {
    await this.orgs.assertOrgRole(organizationId, userId, 'editor');
    let query = this.supabase.service
      .from('league_tournament_links')
      .select(
        '*, leagues(id, name, slug, season_year, scoring_system, scoring_config), league_groups(id, name), tournaments!inner(id, name, weapon, event_id, events!inner(id, name, organization_id))',
      )
      .eq('tournaments.events.organization_id', organizationId)
      .neq('status', 'removed');
    if (leagueId) query = query.eq('league_id', leagueId);
    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  /**
   * Public listing of every distinct event whose tournaments have an
   * approved link to the league. Powers the "Other events in this
   * league" section of the organizer's Memberships tab — already
   * discoverable via league pages elsewhere, so no auth gate.
   */
  async listLeagueMemberEvents(leagueId: string) {
    const { data, error } = await this.supabase.service
      .from('league_tournament_links')
      .select(
        'status, tournaments!inner(event_id, events(id, name, slug, start_date, end_date, organizations(id, name)))',
      )
      .eq('league_id', leagueId)
      .eq('status', 'approved');
    if (error) throw new BadRequestException(error.message);

    const byEventId = new Map<
      string,
      {
        id: string;
        name: string;
        slug: string;
        startDate: string;
        endDate: string | null;
        organization: { id: string; name: string };
      }
    >();
    for (const row of (data ?? []) as Row[]) {
      const tournament = row['tournaments'] as Row | null;
      const event = tournament ? ((tournament['events'] as Row | null) ?? null) : null;
      if (!event) continue;
      const eventId = String(event['id']);
      if (byEventId.has(eventId)) continue;
      const org = (event['organizations'] as Row | null) ?? null;
      byEventId.set(eventId, {
        id: eventId,
        name: String(event['name'] ?? ''),
        slug: String(event['slug'] ?? ''),
        startDate: String(event['start_date'] ?? ''),
        endDate: (event['end_date'] as string | null) ?? null,
        organization: {
          id: org ? String(org['id'] ?? '') : '',
          name: org ? String(org['name'] ?? '') : '',
        },
      });
    }
    return Array.from(byEventId.values());
  }

  async addTournamentLink(
    leagueId: string,
    tournamentId: string,
    userId: string,
    groupId?: string | null,
  ) {
    await this.assertCanManageLeague(leagueId, userId);
    const resolvedGroupId = groupId ?? (await this.defaultGroupIdFor(leagueId));
    if (resolvedGroupId) await this.assertGroupBelongsToLeague(resolvedGroupId, leagueId);
    const { data, error } = await this.supabase.service
      .from('league_tournament_links')
      .upsert(
        {
          league_id: leagueId,
          tournament_id: tournamentId,
          status: 'approved',
          // Both columns are required by migration 0015 — `requested_by`
          // is NOT NULL. On an admin direct-link, the admin acts as both
          // requester AND reviewer in one action, so write themselves
          // to both sides. Missing requested_by_user_id was the source
          // of the operator's "violates not-null constraint" 400.
          requested_by_user_id: userId,
          reviewed_by_user_id: userId,
          reviewed_at: new Date().toISOString(),
          group_id: resolvedGroupId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'league_id,tournament_id' },
      )
      .select('*')
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  /**
   * Which group a link with no explicit group belongs to.
   *
   * A link's ranking key is the weapon plus the group NAME, and a missing group
   * slugifies to `unknown` — a bucket of its own. Standings aggregate on
   * `rankingGroupKey:fighterId`, so a league holding both grouped and ungrouped
   * links splits every fighter who appears in both into TWO rows, each carrying
   * half their season, both on the table at different ranks. Nothing errors.
   *
   * So a group-less link resolves rather than defaulting to null:
   *   - no groups at all  → null, and no split is possible;
   *   - exactly one group → that group, which is the only answer that can be
   *     meant, and is what the bulk event-link endpoint used to miss;
   *   - several groups    → refuse, because the caller has to say which.
   */
  private async defaultGroupIdFor(leagueId: string): Promise<string | null> {
    const groups = await this.listRows('league_groups', 'league_id', leagueId);
    if (groups.length === 0) return null;
    if (groups.length === 1) return String(groups[0]!['id']);
    throw new BadRequestException(
      'This league has several groups — say which one the tournament belongs to.',
    );
  }

  async addEventTournamentLinks(
    leagueId: string,
    eventId: string,
    userId: string,
    groupId?: string | null,
  ) {
    await this.assertCanManageLeague(leagueId, userId);
    const { data: tournaments, error } = await this.supabase.service
      .from('tournaments')
      .select('id')
      .eq('event_id', eventId);
    if (error) throw new BadRequestException(error.message);
    for (const t of (tournaments ?? []) as Row[]) {
      // Passes the group through — omitting it is what made every bulk-linked
      // tournament land in the `unknown` bucket beside the grouped ones.
      await this.addTournamentLink(leagueId, String(t['id']), userId, groupId);
    }
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
      // Freeze: a finalized season's standings must not move as late linked
      // events tick over, so skip it entirely — no results rewrite, no ranking
      // recompute. Reopen (clears finalized_at) lets recompute resume.
      if (league['finalized_at']) continue;
      const config = await this.scoring.resolveConfig(
        normalizeScoringConfig(league['scoring_config']),
      );
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

  /**
   * Gathering only — every rule lives in `league-freshness.ts`.
   *
   * Three reads, none of them an aggregate: PostgREST rejects those, so
   * "latest" is expressed as order + limit 1 throughout. The per-tournament
   * loop is deliberate rather than one big fetch — it costs one single-row
   * query per linked tournament (a season links a handful, not thousands) and
   * avoids pulling every match row in the league just to take a maximum.
   */
  async getFreshness(leagueId: string, userId: string): Promise<LeagueFreshnessReport> {
    await this.assertCanManageLeague(leagueId, userId);
    const league = await this.getLeagueById(leagueId);

    const { data: latestRanking } = await this.supabase.service
      .from('league_rankings')
      .select('computed_at')
      .eq('league_id', leagueId)
      .order('computed_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: links, error: linksError } = await this.supabase.service
      .from('league_tournament_links')
      .select('tournament_id, tournaments(name)')
      .eq('league_id', leagueId)
      .eq('status', 'approved');
    if (linksError) throw new BadRequestException(linksError.message);

    const linkedTournaments: LinkedTournamentChange[] = [];
    for (const link of (links ?? []) as Row[]) {
      const tournamentId = String(link['tournament_id']);
      // `matches` has NO tournament_id — the reach is via phases. A direct
      // .eq('tournament_id') 400s, and a swallowed error would read as "no
      // matches", i.e. permanently fresh.
      const { data: latestMatch } = await this.supabase.service
        .from('matches')
        .select('updated_at, phases!inner(tournament_id)')
        .eq('phases.tournament_id', tournamentId)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      linkedTournaments.push({
        tournamentId,
        name: String((link['tournaments'] as { name?: string } | null)?.name ?? ''),
        lastChangedAt: (latestMatch as { updated_at?: string } | null)?.updated_at ?? null,
      });
    }

    return computeLeagueFreshness({
      finalizedAt: (league['finalized_at'] as string | null) ?? null,
      computedAt: (latestRanking as { computed_at?: string } | null)?.computed_at ?? null,
      linkedTournaments,
    });
  }

  /**
   * What a recompute would complain about, without running one.
   *
   * `validateContributionIdentities` aborts the WHOLE recompute with a 400 when
   * any contributor lacks a global identity, and names at most five people
   * (`.slice(0, 5)`) — so on a big roster the organiser fixes five, runs it
   * again, and meets the next five. This lists all of them, and stays a pure
   * read: it never writes results and never throws on the condition it reports.
   */
  async getRecomputePreflight(leagueId: string, userId: string) {
    await this.assertCanManageLeague(leagueId, userId);

    const { data: links, error: linksError } = await this.supabase.service
      .from('league_tournament_links')
      .select('tournament_id, tournaments(name)')
      .eq('league_id', leagueId)
      .eq('status', 'approved');
    if (linksError) throw new BadRequestException(linksError.message);

    const blocking: Array<{ tournamentName: string; fighterNames: string[] }> = [];
    const contributorIds = new Set<string>();

    for (const link of (links ?? []) as Row[]) {
      const inputs = await this.buildContributionInputs(leagueId, String(link['tournament_id']));
      const tournamentName = String((link['tournaments'] as { name?: string } | null)?.name ?? '');
      const missing = inputs.filter((input) => !input.fighterId);
      if (missing.length > 0) {
        blocking.push({ tournamentName, fighterNames: missing.map((input) => input.fighterName) });
      }
      for (const input of inputs) if (input.fighterId) contributorIds.add(input.fighterId);
    }

    return {
      blocking,
      unstableIdentities: await this.findUnstableContributors([...contributorIds]),
    };
  }

  /**
   * Contributors who carry neither a club nor a HEMA Ratings id, so no matching
   * tier can link them at their next event and their points start over under a
   * fresh identity. Scoped to people who ACTUALLY scored — the roster-wide
   * version of this warning already fires when the identity is minted.
   */
  private async findUnstableContributors(fighterIds: string[]): Promise<string[]> {
    if (fighterIds.length === 0) return [];
    const { data, error } = await this.supabase.service
      .from('global_persons')
      .select('display_name, club_id, hema_ratings_id')
      .in('id', fighterIds)
      .is('club_id', null)
      .is('hema_ratings_id', null);
    if (error) throw new BadRequestException(error.message);
    return ((data ?? []) as Row[]).map((row) => String(row['display_name'] ?? ''));
  }

  async recomputeLeagueRankings(leagueId: string, userId?: string) {
    if (userId) await this.assertCanManageLeague(leagueId, userId);
    const league = await this.getLeagueById(leagueId);
    // Freeze guard: a finalized season's table is frozen — refuse to recompute
    // it (the manual-recompute endpoint surfaces this as a 400). recomputeForEvent
    // already skips finalized leagues, so its internal calls never reach here.
    if (league['finalized_at']) {
      throw new BadRequestException(
        'This league season is finalized. Reopen it before recomputing rankings.',
      );
    }
    const config = await this.scoring.resolveConfig(
      normalizeScoringConfig(league['scoring_config']),
    );
    // The display name is EMBEDDED rather than left empty, and that is
    // load-bearing rather than cosmetic.
    //
    // `compareRankings` ends in `fighterName.localeCompare(...)`, falling back to
    // the fighter id only when the names are equal. This is the one path that
    // writes `league_rankings`, so passing '' for every name made that
    // comparison always return 0 and handed the last word to
    // `fighterId.localeCompare` — ordering fighters level on every configured
    // rung by their global-person UUID. Stable within one database and arbitrary
    // everywhere else: restore a season from an archive, where identities are
    // recreated with new ids, and tied fighters reshuffle for no visible reason.
    //
    // `league_tournament_results` carries no name column (migration 0015), so the
    // name is read through the same `global_persons` embed the standings query
    // uses. Joined rather than denormalised on purpose — a stored copy would go
    // stale the first time somebody corrects a spelling.
    const { data: resultRows, error: resultsError } = await this.supabase.service
      .from('league_tournament_results')
      .select('*, global_persons(display_name)')
      .eq('league_id', leagueId);
    if (resultsError) throw new BadRequestException(resultsError.message);
    const rows = (resultRows ?? []) as Row[];
    const contributions: LeagueTournamentContribution[] = rows.map((row) => ({
      leagueId,
      tournamentId: String(row['tournament_id']),
      eventId: String(row['event_id']),
      fighterId: String(row['fighter_id']),
      fighterName: String(
        (row['global_persons'] as { display_name?: string | null } | null)?.display_name ?? '',
      ),
      clubName: null,
      clubCity: null,
      rankingGroupKey: String(row['ranking_group_key']),
      weapon: null,
      groupName: null,
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
    return this.fetchStandingsPayload(league, leagueId, group);
  }

  /**
   * Same standings shape as the public endpoint but auth-gated on
   * league-manage permissions instead of public visibility — lets the
   * admin Ranking page render rankings for draft / unlisted leagues
   * that the operator still owns.
   */
  async adminStandings(leagueId: string, userId: string, group?: string) {
    await this.assertCanManageLeague(leagueId, userId);
    const league = await this.getLeagueById(leagueId);
    return this.fetchStandingsPayload(league, leagueId, group);
  }

  private async fetchStandingsPayload(league: Row, leagueId: string, group?: string) {
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

    // Approved tournaments that have contributed no results yet — i.e. not
    // decided (bracket final unsettled / pool-only still in play). Derived
    // cheaply from persisted state: recompute writes league_tournament_results
    // only for decided tournaments, so an approved link with no results row is
    // still awaiting results. One extra SELECT, no per-tournament recompute.
    const { data: resultRows } = await this.supabase.service
      .from('league_tournament_results')
      .select('tournament_id')
      .eq('league_id', leagueId);
    const countedTournamentIds = new Set(
      ((resultRows ?? []) as Row[]).map((row) => String(row['tournament_id'])),
    );
    const pendingTournaments = ((links ?? []) as Row[])
      .filter((link) => !countedTournamentIds.has(String(link['tournament_id'])))
      .map((link) => {
        const tournament = (link['tournaments'] as Row | null) ?? null;
        const event = tournament ? ((tournament['events'] as Row | null) ?? null) : null;
        return {
          tournamentId: String(link['tournament_id']),
          name: tournament ? String(tournament['name'] ?? '') : '',
          eventName: event ? String(event['name'] ?? '') : '',
        };
      });

    // Per-row deciding tie-breaker: for each fighter, the first configured
    // tie-breaker key on which they differ from the fighter directly above them
    // in the same ranking group. Read-time derivation over the already-sorted
    // rows — no migration; every value it needs is on the row already.
    const tieBreakers = normalizeScoringConfig(league['scoring_config']).tieBreakers;
    const rows = attachDecidingTiebreaks((data ?? []) as Row[], tieBreakers);

    return {
      league,
      columns: links ?? [],
      rows,
      pendingTournaments,
    };
  }

  /**
   * Club / team standings, aggregated at read time from `league_rankings`
   * (no new table). Public-gated exactly like `standings`.
   */
  async clubStandings(leagueId: string, group?: string) {
    const league = await this.getLeagueById(leagueId);
    if (league['public_visibility'] !== true || league['status'] !== 'published') {
      throw new NotFoundException(`League ${leagueId} not found`);
    }
    return this.fetchClubStandingsPayload(league, leagueId, group);
  }

  /**
   * Admin-side club standings — manage-gated instead of public-visibility gated,
   * mirroring the `standings` / `adminStandings` split.
   */
  async adminClubStandings(leagueId: string, userId: string, group?: string) {
    await this.assertCanManageLeague(leagueId, userId);
    const league = await this.getLeagueById(leagueId);
    return this.fetchClubStandingsPayload(league, leagueId, group);
  }

  private async fetchClubStandingsPayload(league: Row, leagueId: string, group?: string) {
    let q = this.supabase.service
      .from('league_rankings')
      .select(
        'fighter_id, ranking_group_key, total_points, medal_count, global_persons(display_name, club_id, clubs(id, name, city))',
      )
      .eq('league_id', leagueId);
    if (group) q = q.eq('ranking_group_key', group) as typeof q;
    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    const { clubs, unaffiliated } = aggregateClubStandings((data ?? []) as Row[]);
    return { league, clubs, unaffiliated };
  }

  // ── Season lifecycle: clone + finalize ──────────────────────────────────────

  /**
   * Roll a league into a new season: create a NEW league copying the
   * configuration (name, scoring, description, logo) and the management
   * structure (groups, org roles, user roles), but NONE of the results —
   * league_tournament_links, league_tournament_results and league_rankings are
   * deliberately not copied, so the new season starts empty. The clone starts as
   * a draft; the operator publishes it when ready.
   */
  async clone(leagueId: string, dto: { seasonYear: number; name?: string }, userId: string) {
    await this.assertCanManageLeague(leagueId, userId);
    const source = await this.getLeagueById(leagueId);
    const name = (dto.name?.trim() || String(source['name'] ?? '')).trim();
    if (name.length < 2) throw new BadRequestException('League name is required');
    const slug = await this.generateUniqueLeagueSlug(name, dto.seasonYear);

    const { data, error } = await this.supabase.service
      .from('leagues')
      .insert({
        name,
        slug,
        season_year: dto.seasonYear,
        description: source['description'] ?? null,
        logo_url: source['logo_url'] ?? null,
        scoring_system: source['scoring_system'],
        scoring_config: source['scoring_config'],
        created_by_user_id: userId,
      })
      .select('*')
      .single();
    if (error) {
      if (error.message.includes('duplicate')) throw new ConflictException('League slug exists');
      throw new BadRequestException(error.message);
    }
    const newLeagueId = String((data as Row)['id']);

    // Copy groups (name + sort_order) — NOT tournament links / results / rankings.
    const groups = await this.listRows('league_groups', 'league_id', leagueId);
    if (groups.length > 0) {
      const { error: groupErr } = await this.supabase.service.from('league_groups').insert(
        groups.map((g) => ({
          league_id: newLeagueId,
          name: String(g['name'] ?? ''),
          sort_order: Number(g['sort_order'] ?? 0),
        })),
      );
      if (groupErr) throw new BadRequestException(groupErr.message);
    }

    // Copy organization roles verbatim.
    const orgRoles = await this.listRows('league_organization_roles', 'league_id', leagueId);
    if (orgRoles.length > 0) {
      const { error: orgErr } = await this.supabase.service
        .from('league_organization_roles')
        .insert(
          orgRoles.map((r) => ({
            league_id: newLeagueId,
            organization_id: String(r['organization_id']),
            role: String(r['role']),
          })),
        );
      if (orgErr) throw new BadRequestException(orgErr.message);
    }

    // Copy user roles, then guarantee the cloner keeps an owner grant so they can
    // manage the new season even if they only reached the source via their org
    // or as a super admin (no direct row to copy). Deduped by user so the batch
    // never carries the same user twice.
    const userRoles = await this.listRows('league_user_roles', 'league_id', leagueId);
    const roleByUser = new Map<string, string>();
    for (const r of userRoles) roleByUser.set(String(r['user_id']), String(r['role']));
    if (!roleByUser.has(userId)) roleByUser.set(userId, 'owner');
    const { error: userErr } = await this.supabase.service.from('league_user_roles').insert(
      [...roleByUser.entries()].map(([user_id, role]) => ({
        league_id: newLeagueId,
        user_id,
        role,
      })),
    );
    if (userErr) throw new BadRequestException(userErr.message);

    return data;
  }

  /** Freeze a season: stamp finalized_at so recompute stops moving the table. */
  async finalize(leagueId: string, userId: string) {
    await this.assertCanManageLeague(leagueId, userId);
    return this.setFinalizedAt(leagueId, new Date().toISOString());
  }

  /** Reopen a finalized season: clear finalized_at so recompute resumes. */
  async reopen(leagueId: string, userId: string) {
    await this.assertCanManageLeague(leagueId, userId);
    return this.setFinalizedAt(leagueId, null);
  }

  private async setFinalizedAt(leagueId: string, value: string | null) {
    const { data, error } = await this.supabase.service
      .from('leagues')
      .update({ finalized_at: value, updated_at: new Date().toISOString() })
      .eq('id', leagueId)
      .select('*')
      .single();
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  /**
   * A slug not yet taken by another league: the toSlug of the name, then the
   * name + season year, then a numbered suffix on that — mirroring the admin
   * toSlug helper with a season/-2 de-dup suffix on conflict.
   */
  private async generateUniqueLeagueSlug(name: string, seasonYear: number): Promise<string> {
    const base = slugifyLeagueName(name) || 'league';
    const { data } = await this.supabase.service
      .from('leagues')
      .select('slug')
      .ilike('slug', `${base}%`);
    const taken = new Set(((data ?? []) as Row[]).map((row) => String(row['slug'])));
    for (const candidate of [base, `${base}-${seasonYear}`]) {
      if (!taken.has(candidate)) return candidate;
    }
    let n = 2;
    let candidate = `${base}-${seasonYear}-${n}`;
    while (taken.has(candidate)) {
      n += 1;
      candidate = `${base}-${seasonYear}-${n}`;
    }
    return candidate;
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
    const inputs = await this.buildContributionInputs(leagueId, tournamentId);
    // An unrated event kind or an undecided bracket yields no inputs, and the
    // scoring engine must not be reached in that case — the early returns used
    // to live in this method and tests guard that they still short-circuit.
    // `replaceTournamentResults` still deletes on an empty result, so the
    // self-heal in both directions is unaffected.
    if (inputs.length === 0) return [];
    return this.scoring.toTournamentContributions(config, inputs);
  }

  /**
   * The gathering half of a recompute, stopping one step BEFORE
   * `toTournamentContributions` validates identities and throws.
   *
   * Split out so the pre-flight can inspect what a recompute would find without
   * triggering the 400 it is trying to explain. Every precondition stays here —
   * event kind, decided placements, registrations with a placement — because a
   * pre-flight that skipped them would nag about people who cannot block
   * anything.
   */
  private async buildContributionInputs(
    leagueId: string,
    tournamentId: string,
  ): Promise<TournamentContributionInput[]> {
    const tournament = await this.getTournamentWithEvent(tournamentId);
    // Only STANDARD events contribute to a league — test events are dry runs
    // and club events are internal activity. Returning no contributions makes
    // replaceTournamentResults delete any existing rows for this tournament, so
    // a recompute (incl. the one updateEvent triggers when an event's kind
    // changes) self-heals in BOTH directions: rows drop when an event becomes
    // unrated and come back when it becomes standard again.
    if (!countsTowardStats(asEventKind(tournament['event_kind']))) return [];
    // No placement service wired (only in some unit constructions) → nothing to
    // score. Production always injects it.
    if (!this.placement) return [];
    // Resolve the authoritative placement FIRST. Not decided yet (bracket final
    // unsettled, or a pool-only tournament still in play) → contribute nothing,
    // and skip the identity/match/exchange reads entirely. Like an unrated kind,
    // this self-heals: rows are deleted until the tournament decides, so league
    // points never reflect a mid-play snapshot.
    const placements = await this.placement.getTournamentPlacements(tournamentId);
    if (!placements.decided) return [];
    const [registrations, matches, groupName] = await Promise.all([
      this.listRegistrationsWithIdentity(tournamentId),
      this.listMatchesForTournament(tournamentId),
      this.lookupLinkGroupName(leagueId, tournamentId),
    ]);
    const matchIds = matches.map((match) => String(match['id']));
    const exchanges =
      matchIds.length === 0 ? [] : await this.listRowsIn('exchanges', 'match_id', matchIds);
    const doubleHits = this.doubleHitsByRegistration(matches, exchanges);
    return this.toContributionInputs(
      leagueId,
      tournament,
      groupName,
      registrations,
      doubleHits,
      placements,
    );
  }

  /**
   * Build one league contribution per registration from the authoritative
   * tournament placement (the SAME `computeFinalRanking` the public tournament
   * page and fighter profiles use). `finalRank` + `resultKind` come from the
   * shared placement; identity (global_person_id) + double-hits stay sourced
   * here. Registrations with no placement (didn't compete / not in the ranked
   * field) are skipped.
   */
  private toContributionInputs(
    leagueId: string,
    tournament: Row,
    groupName: string | null,
    registrations: Row[],
    doubleHits: Map<string, number>,
    placements: { byRegistrationId: Map<string, { place: number; resultKind: string }> },
  ): TournamentContributionInput[] {
    const inputs: TournamentContributionInput[] = [];
    for (const registration of registrations) {
      const registrationId = String(registration['id']);
      const placement = placements.byRegistrationId.get(registrationId);
      if (!placement) continue;
      const person = registration['persons'] as Row | null;
      const fighter = registration['global_persons'] as Row | null;
      const name =
        String(fighter?.['display_name'] ?? '').trim() ||
        `${person?.['given_name'] ?? ''} ${person?.['family_name'] ?? ''}`.trim() ||
        registrationId;
      inputs.push({
        leagueId,
        tournamentId: String(tournament['id']),
        eventId: String(tournament['event_id']),
        fighterId:
          ((registration['persons'] as { global_person_id?: string | null } | null)
            ?.global_person_id ??
            null) ||
          null,
        fighterName: name,
        clubName: null,
        clubCity: null,
        weapon: (tournament['weapon'] as string | null) ?? null,
        groupName,
        finalRank: placement.place,
        resultKind: placement.resultKind as TournamentContributionInput['resultKind'],
        doubleHits: doubleHits.get(registrationId) ?? 0,
      });
    }
    return inputs;
  }

  private async lookupLinkGroupName(
    leagueId: string,
    tournamentId: string,
  ): Promise<string | null> {
    const { data } = await this.supabase.service
      .from('league_tournament_links')
      .select('league_groups(name)')
      .eq('league_id', leagueId)
      .eq('tournament_id', tournamentId)
      .maybeSingle();
    const link = data as { league_groups?: { name?: string } | null } | null;
    return link?.league_groups?.name ?? null;
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
      .select('*, events(organization_id, event_kind)')
      .eq('id', tournamentId)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException(`Tournament ${tournamentId} not found`);
    const row = data as Row & { events?: Row | null };
    return {
      ...row,
      organization_id: row.events?.['organization_id'],
      event_kind: asEventKind(row.events?.['event_kind']),
    };
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
    if (await this.isPlatformStaffAdmin(userId)) return;
    const { data: directRole } = await this.supabase.service
      .from('league_user_roles')
      .select('role')
      .eq('league_id', leagueId)
      .eq('user_id', userId)
      .in('role', ['admin', 'owner'])
      .maybeSingle();
    if (directRole) return;

    if (await this.hasOrgManagePath(leagueId, userId)) return;

    throw new ForbiddenException('League admin access required');
  }

  /**
   * True when the user manages this league through an organization they admin,
   * i.e. their access survives the removal of any personal league_user_roles
   * row. Shared with removeUserRole so its self-removal error can't claim the
   * caller is losing access they in fact keep via their org.
   */
  private async hasOrgManagePath(leagueId: string, userId: string): Promise<boolean> {
    const orgMemberships = await this.listRows('organization_members', 'user_id', userId);
    const adminOrgIds = orgMemberships
      .filter((row) => ['admin', 'owner'].includes(String(row['role'])))
      .map((row) => String(row['organization_id']));
    if (adminOrgIds.length === 0) return false;

    // .limit(1), not .maybeSingle(): a user who admins two orgs that both hold
    // a role on this league matches two rows, which nulls `data` and sets
    // PGRST116 — silently denying a manager access to their own league.
    const { data: orgRoles } = await this.supabase.service
      .from('league_organization_roles')
      .select('id')
      .eq('league_id', leagueId)
      .in('organization_id', adminOrgIds)
      .in('role', ['admin', 'owner'])
      .limit(1);
    return Array.isArray(orgRoles) && orgRoles.length > 0;
  }

  /**
   * True when the league keeps at least one manager once `excludedUserId`'s
   * personal grant is gone. Counts BOTH axes on purpose: a league managed only
   * through an organization is legitimate, and so is one whose individual grants
   * are all `admin` with no `owner` — so neither "keep one owner" nor "keep one
   * league_user_roles row" is the right invariant.
   */
  private async wouldRetainAManager(leagueId: string, excludedUserId: string): Promise<boolean> {
    const { data: userRoles } = await this.supabase.service
      .from('league_user_roles')
      .select('user_id')
      .eq('league_id', leagueId)
      .in('role', ['admin', 'owner'])
      .neq('user_id', excludedUserId)
      .limit(1);
    if (Array.isArray(userRoles) && userRoles.length > 0) return true;

    const { data: orgRoles } = await this.supabase.service
      .from('league_organization_roles')
      .select('id')
      .eq('league_id', leagueId)
      .in('role', ['admin', 'owner'])
      .limit(1);
    return Array.isArray(orgRoles) && orgRoles.length > 0;
  }

  /**
   * Platform admins and above.
   *
   * League management is squarely the platform-admin domain, and the widening
   * matters here more than anywhere else: `/admin/leagues/*` carries NO route
   * guard, so `assertCanManageLeague` is the only gate on it. Named for the
   * tier rather than "isSuperAdmin" so the next reader is not misled about
   * what passes.
   */
  private async isPlatformStaffAdmin(userId: string): Promise<boolean> {
    return hasPlatformTier(this.supabase, userId, 'platform_admin');
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

  /**
   * Registrations joined with their canonical identity. Identity flows
   * via person_id → persons.global_person_id (the legacy
   * registrations.fighter_id column was retired in 0083).
   */
  private async listRegistrationsWithIdentity(tournamentId: string): Promise<Row[]> {
    const { data, error } = await this.supabase.service
      .from('registrations')
      .select('*, persons!inner(global_person_id, given_name, family_name)')
      .eq('tournament_id', tournamentId);
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

/**
 * Slugify a league name — the API-side twin of the admin `toSlug`
 * (apps/web-admin/app/admin/leagues/league-utils.ts): NFD-strip accents,
 * lowercase, non-alphanumerics to hyphens, trim leading/trailing hyphens.
 */
function slugifyLeagueName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Formula-safe: league standings are downloaded and opened in a spreadsheet, and
 * fighter and club names come from the roster. See @myclash/types/csv — plain
 * numbers stay numeric so points columns still sum.
 */
const csv = toCsvCell;

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
