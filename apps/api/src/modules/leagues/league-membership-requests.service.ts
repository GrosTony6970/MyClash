import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { insertAuditLog } from '../../common/audit-log';
import { OrganizationsService } from '../organizations/organizations.service';

/**
 * Bundle 3 — org-side "request to join a league" workflow.
 *
 * Org admins POST a request via /orgs/:orgId/league-requests; super-admins
 * (or league admins) review via /admin/league-membership-requests/:id.
 * Approval upserts a row into `league_organization_roles`; rejection /
 * withdrawal just flip the status so the audit trail survives.
 */

export type LeagueMembershipRequestStatus = 'requested' | 'approved' | 'rejected' | 'withdrawn';

export interface LeagueMembershipRequestRow {
  id: string;
  league_id: string;
  organization_id: string;
  requested_role: string;
  status: LeagueMembershipRequestStatus;
  message: string | null;
  requested_by_user_id: string | null;
  requested_at: string;
  reviewed_by_user_id: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateLeagueMembershipRequestDto {
  leagueId: string;
  message?: string;
  requestedRole?: 'member' | 'admin';
}

export interface ReviewLeagueMembershipRequestDto {
  status: 'approved' | 'rejected';
  reviewNote?: string;
}

const ALLOWED_REQUESTED_ROLES = ['member', 'admin'] as const;

@Injectable()
export class LeagueMembershipRequestsService {
  private readonly logger = new Logger(LeagueMembershipRequestsService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly orgs: OrganizationsService,
  ) {}

  // ── Submission (org admin) ────────────────────────────────────────────────

  async submit(
    organizationId: string,
    dto: CreateLeagueMembershipRequestDto,
    userId: string,
  ): Promise<LeagueMembershipRequestRow> {
    // Caller must be an org admin of `organizationId`.
    await this.orgs.assertOrgRole(organizationId, userId, 'admin');

    // Platform org can never join a league as a member.
    const { data: org, error: orgError } = await this.supabase.service
      .from('organizations')
      .select('id, slug, is_platform')
      .eq('id', organizationId)
      .maybeSingle();
    if (orgError) throw new BadRequestException(orgError.message);
    if (!org) throw new NotFoundException('Organization not found.');
    const platformOrg =
      (org as { is_platform?: boolean; slug?: string }).is_platform === true ||
      (org as { slug?: string }).slug === 'myclash-hq';
    if (platformOrg) {
      throw new BadRequestException(
        'The MyClash platform organisation cannot request league membership.',
      );
    }

    // League must exist + be visible.
    const { data: league, error: leagueError } = await this.supabase.service
      .from('leagues')
      .select('id, name')
      .eq('id', dto.leagueId)
      .maybeSingle();
    if (leagueError) throw new BadRequestException(leagueError.message);
    if (!league) throw new NotFoundException(`League ${dto.leagueId} not found`);

    // Already a member?
    const { data: existingRole } = await this.supabase.service
      .from('league_organization_roles')
      .select('organization_id')
      .eq('league_id', dto.leagueId)
      .eq('organization_id', organizationId)
      .maybeSingle();
    if (existingRole) {
      throw new ConflictException('Organization is already a member of this league.');
    }

    // Existing pending request?
    const { data: pendingRow } = await this.supabase.service
      .from('league_membership_requests')
      .select('id')
      .eq('league_id', dto.leagueId)
      .eq('organization_id', organizationId)
      .eq('status', 'requested')
      .maybeSingle();
    if (pendingRow) {
      throw new ConflictException('A pending request already exists for this league.');
    }

    const requestedRole = dto.requestedRole ?? 'member';
    if (!(ALLOWED_REQUESTED_ROLES as readonly string[]).includes(requestedRole)) {
      throw new BadRequestException(`Invalid requested role: ${requestedRole}`);
    }

    const { data, error } = await this.supabase.service
      .from('league_membership_requests')
      .insert({
        league_id: dto.leagueId,
        organization_id: organizationId,
        requested_role: requestedRole,
        status: 'requested',
        message: dto.message?.trim() || null,
        requested_by_user_id: userId,
      })
      .select('*')
      .single();
    if (error) throw new BadRequestException(error.message);
    return data as LeagueMembershipRequestRow;
  }

  // ── Review (super-admin / league-admin) ───────────────────────────────────

  async review(
    requestId: string,
    dto: ReviewLeagueMembershipRequestDto,
    userId: string,
  ): Promise<LeagueMembershipRequestRow> {
    const existing = await this.getById(requestId);
    if (existing.status !== 'requested') {
      throw new BadRequestException(
        `Cannot review a request in status '${existing.status}'. Only 'requested' rows are reviewable.`,
      );
    }

    await this.assertCanReview(existing.league_id, userId);

    if (dto.status !== 'approved' && dto.status !== 'rejected') {
      throw new BadRequestException('status must be "approved" or "rejected"');
    }

    const now = new Date().toISOString();

    if (dto.status === 'approved') {
      // Promote the org into the league. Use upsert so a stale role row
      // doesn't block approval — last write wins for the role.
      const { error: roleErr } = await this.supabase.service
        .from('league_organization_roles')
        .upsert(
          {
            league_id: existing.league_id,
            organization_id: existing.organization_id,
            role: existing.requested_role,
          },
          { onConflict: 'league_id,organization_id' },
        );
      if (roleErr) throw new BadRequestException(roleErr.message);
    }

    const { data, error } = await this.supabase.service
      .from('league_membership_requests')
      .update({
        status: dto.status,
        reviewed_by_user_id: userId,
        reviewed_at: now,
        review_note: dto.reviewNote?.trim() || null,
        updated_at: now,
      })
      .eq('id', requestId)
      .select('*')
      .single();
    if (error) throw new BadRequestException(error.message);
    return data as LeagueMembershipRequestRow;
  }

  // ── Withdraw (org admin) ──────────────────────────────────────────────────

  async withdraw(requestId: string, userId: string): Promise<LeagueMembershipRequestRow> {
    const existing = await this.getById(requestId);
    if (existing.status !== 'requested') {
      throw new BadRequestException(`Cannot withdraw a request in status '${existing.status}'.`);
    }
    // Only an admin of the requesting org can withdraw.
    await this.orgs.assertOrgRole(existing.organization_id, userId, 'admin');

    const now = new Date().toISOString();
    const { data, error } = await this.supabase.service
      .from('league_membership_requests')
      .update({ status: 'withdrawn', updated_at: now })
      .eq('id', requestId)
      .select('*')
      .single();
    if (error) throw new BadRequestException(error.message);

    await this.writeAuditLog(userId, 'league.membership_request.withdrawn', requestId, {
      leagueId: existing.league_id,
      organizationId: existing.organization_id,
      previousStatus: 'requested',
    });
    return data as LeagueMembershipRequestRow;
  }

  // ── Listing ───────────────────────────────────────────────────────────────

  async listByLeague(leagueId: string, status?: LeagueMembershipRequestStatus) {
    let q = this.supabase.service
      .from('league_membership_requests')
      .select('*, organizations:organization_id(id, name, slug, logo_url)')
      .eq('league_id', leagueId)
      .order('requested_at', { ascending: false });
    if (status) q = q.eq('status', status) as typeof q;
    const { data, error } = await q;
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async listByOrganization(organizationId: string, userId: string) {
    await this.orgs.assertOrgRole(organizationId, userId, 'admin');
    const { data, error } = await this.supabase.service
      .from('league_membership_requests')
      .select('*, leagues:league_id(id, name, slug)')
      .eq('organization_id', organizationId)
      .order('requested_at', { ascending: false });
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async listPendingAll() {
    const { data, error } = await this.supabase.service
      .from('league_membership_requests')
      .select('*, leagues:league_id(id, name, slug), organizations:organization_id(id, name, slug)')
      .eq('status', 'requested')
      .order('requested_at', { ascending: false });
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  async getById(id: string): Promise<LeagueMembershipRequestRow> {
    const { data, error } = await this.supabase.service
      .from('league_membership_requests')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException(`Membership request ${id} not found`);
    return data as LeagueMembershipRequestRow;
  }

  /**
   * Reviewers are super-admins or league admins (anyone with manage rights
   * on the target league). Mirrors LeaguesService.assertCanManageLeague
   * — duplicated here to avoid a circular import.
   */
  private async assertCanReview(leagueId: string, userId: string): Promise<void> {
    if (!userId) throw new ForbiddenException('Authentication required.');

    const { data: platform } = await this.supabase.service
      .from('platform_roles')
      .select('role')
      .eq('user_id', userId)
      .eq('role', 'super_admin')
      .maybeSingle();
    if (platform) return;

    const { data: userRole } = await this.supabase.service
      .from('league_user_roles')
      .select('role')
      .eq('league_id', leagueId)
      .eq('user_id', userId)
      .in('role', ['owner', 'admin'])
      .maybeSingle();
    if (userRole) return;

    // Org-based path: the user is admin/owner of an organization that holds an
    // admin/owner role on this league. Mirrors LeaguesService.assertCanManageLeague
    // — without this, an org owner who manages the league via league_organization_roles
    // (rather than a direct league_user_roles row) cannot review requests.
    const { data: memberships } = await this.supabase.service
      .from('organization_members')
      .select('organization_id, role')
      .eq('user_id', userId);
    const adminOrgIds = (memberships ?? [])
      .filter((row) => ['admin', 'owner'].includes(String((row as { role?: unknown }).role)))
      .map((row) => String((row as { organization_id?: unknown }).organization_id));
    if (adminOrgIds.length > 0) {
      // .limit(1), not .maybeSingle(): a user who admins two orgs that both hold
      // a role on this league matches two rows, which nulls `data` and sets
      // PGRST116 — silently denying a reviewer their own league.
      const { data: orgRoles } = await this.supabase.service
        .from('league_organization_roles')
        .select('id')
        .eq('league_id', leagueId)
        .in('organization_id', adminOrgIds)
        .in('role', ['admin', 'owner'])
        .limit(1);
      if (Array.isArray(orgRoles) && orgRoles.length > 0) return;
    }

    throw new ForbiddenException('Only super-admins or league admins can review this request.');
  }

  /**
   * Audit-log helper. Mirrors AdminFeatureFlagsService.writeAuditLog —
   * swallow errors so audit logging never blocks the primary action.
   */
  private async writeAuditLog(
    actorUserId: string,
    action: string,
    entityId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const { error } = await insertAuditLog(this.supabase.service, {
      actorUserId,
      action,
      entityType: 'league_membership_request',
      entityId,
      payload,
    });
    if (error) {
      this.logger.warn(
        `Could not write audit log for ${action} on league_membership_request:${entityId}`,
      );
    }
  }
}
