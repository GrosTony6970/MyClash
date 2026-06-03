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
    const isSuperAdmin = await this.isSuperAdmin(userId);
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
    if (groupId) await this.assertGroupBelongsToLeague(groupId, leagueId);
    const { data, error } = await this.supabase.service
      .from('league_tournament_links')
      .upsert(
        {
          league_id: leagueId,
          tournament_id: tournamentId,
          status: 'approved',
          reviewed_by_user_id: userId,
          reviewed_at: new Date().toISOString(),
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

  async addEventTournamentLinks(leagueId: string, eventId: string, userId: string) {
    await this.assertCanManageLeague(leagueId, userId);
    const { data: tournaments, error } = await this.supabase.service
      .from('tournaments')
      .select('id')
      .eq('event_id', eventId);
    if (error) throw new BadRequestException(error.message);
    for (const t of (tournaments ?? []) as Row[]) {
      await this.addTournamentLink(leagueId, String(t['id']), userId);
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

  async recomputeLeagueRankings(leagueId: string, userId?: string) {
    if (userId) await this.assertCanManageLeague(leagueId, userId);
    const league = await this.getLeagueById(leagueId);
    const config = await this.scoring.resolveConfig(
      normalizeScoringConfig(league['scoring_config']),
    );
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
    const [registrations, matches, groupName] = await Promise.all([
      this.listRegistrationsWithIdentity(tournamentId),
      this.listMatchesForTournament(tournamentId),
      this.lookupLinkGroupName(leagueId, tournamentId),
    ]);
    const matchIds = matches.map((match) => String(match['id']));
    const exchanges =
      matchIds.length === 0 ? [] : await this.listRowsIn('exchanges', 'match_id', matchIds);
    const doubleHits = this.doubleHitsByRegistration(matches, exchanges);
    const rankedInputs = this.rankTournament(
      leagueId,
      tournament,
      groupName,
      registrations,
      matches,
      doubleHits,
    );
    return this.scoring.toTournamentContributions(config, rankedInputs);
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

  private rankTournament(
    leagueId: string,
    tournament: Row,
    groupName: string | null,
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
