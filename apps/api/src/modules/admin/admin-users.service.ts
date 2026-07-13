import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import {
  CreatePlatformUserDto,
  ORG_ROLES,
  UpdatePlatformUserDto,
  type OrgRole,
} from './dto/admin-users.dto';
import { SupabaseService, type SupabaseAdminUser } from '../supabase/supabase.service';

export interface ListUsersQuery {
  page?: number;
  perPage?: number;
  q?: string;
  /**
   * `'staff'` (default) restricts the listing to real platform accounts —
   * super-admins or members of any organization. `'all'` returns every
   * `auth.users` row, including public self-signups (e.g. Google logins that
   * hold no role or organization).
   */
  scope?: 'staff' | 'all';
}

export type DeletePlatformUserMode = 'safe' | 'cleanup';

interface UserDeletionBlockers {
  references: Record<string, number>;
  soleOwnerOrganizationIds: string[];
}

export interface UserOrgMembership {
  id: string;
  name: string;
  slug: string;
  role: OrgRole;
}

type ListedPlatformUser = SupabaseAdminUser & {
  display_name: string | null;
  organizations: UserOrgMembership[];
  is_super_admin: boolean;
};

@Injectable()
export class AdminUsersService {
  private readonly logger = new Logger(AdminUsersService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async listUsers(query: ListUsersQuery = {}) {
    const page = query.page ?? 1;
    const perPage = query.perPage ?? 50;
    const search = query.q?.trim();
    const scope: 'staff' | 'all' = query.scope === 'all' ? 'all' : 'staff';

    // Fast path — show every login unfiltered: a single GoTrue admin page,
    // matching the historical behaviour before scopes existed.
    if (scope === 'all' && !search) {
      const response = await this.supabase.listAuthAdminUsers(page, perPage);
      if (!response.ok || !response.data) {
        this.logger.warn(`Could not list Auth users through GoTrue: ${response.status}`);
        throw new BadRequestException('Could not inspect platform accounts');
      }
      const ids = response.data.users.map((u) => u.id);
      const [orgsByUser, superAdminIds] = await Promise.all([
        this.fetchOrgMembershipsByUser(ids),
        this.fetchSuperAdminIds(),
      ]);
      return {
        users: response.data.users.map((user) =>
          this.toListedUser(user, orgsByUser.get(user.id), superAdminIds.has(user.id)),
        ),
      };
    }

    // Staff scope (any) or a search: enumerate auth users and filter in-app.
    return this.listMaterialized({ scope, search, page, perPage });
  }

  async getUser(userId: string) {
    const response = await this.supabase.getAuthAdminUser(userId);
    if (!response.ok || !response.data?.id) {
      throw new NotFoundException(`User ${userId} not found`);
    }
    const [orgsByUser, superAdminIds] = await Promise.all([
      this.fetchOrgMembershipsByUser([userId]),
      this.fetchSuperAdminIds(),
    ]);
    return {
      user: this.toListedUser(response.data, orgsByUser.get(userId), superAdminIds.has(userId)),
    };
  }

  async updateUser(userId: string, dto: UpdatePlatformUserDto, actorUserId: string) {
    const payload: { email?: string; user_metadata?: Record<string, unknown> } = {};
    if (dto.email !== undefined) {
      payload.email = dto.email.trim().toLowerCase();
    }
    if (dto.displayName !== undefined) {
      const trimmed = dto.displayName.trim();
      payload.user_metadata = { display_name: trimmed.length > 0 ? trimmed : null };
    }
    if (Object.keys(payload).length === 0) {
      // No-op
      return this.getUser(userId);
    }
    const response = await this.supabase.updateAuthAdminUser(userId, payload);
    if (!response.ok) {
      this.logger.warn(`Could not update Auth user through GoTrue: ${response.status}`);
      throw new BadRequestException('Could not update platform account');
    }
    await this.writeAuditLog(actorUserId, 'user.update', 'user', userId, {
      email: payload.email ?? undefined,
      display_name_set: payload.user_metadata !== undefined,
    });
    return this.getUser(userId);
  }

  async addOrgMembership(
    userId: string,
    organizationId: string,
    role: OrgRole,
    actorUserId: string,
  ): Promise<UserOrgMembership> {
    if (!ORG_ROLES.includes(role)) {
      throw new BadRequestException(`Invalid role: ${role}`);
    }
    // Super-admins are platform-scoped; they must not belong to any org.
    // Mirror check in OrganizationsService.addMember.
    await this.assertNotSuperAdmin(userId);
    const { data: existing } = await this.supabase.service
      .from('organization_members')
      .select('id')
      .eq('user_id', userId)
      .eq('organization_id', organizationId)
      .maybeSingle();
    if (existing) {
      throw new ConflictException('User already belongs to this organization');
    }
    const { error } = await this.supabase.service
      .from('organization_members')
      .insert({ user_id: userId, organization_id: organizationId, role });
    if (error) throw new BadRequestException(error.message);

    await this.writeAuditLog(actorUserId, 'user.org_membership.add', 'user', userId, {
      organization_id: organizationId,
      role,
    });

    const { data: org } = await this.supabase.service
      .from('organizations')
      .select('id, name, slug')
      .eq('id', organizationId)
      .maybeSingle();
    return {
      id: organizationId,
      name: (org as { name?: string } | null)?.name ?? '',
      slug: (org as { slug?: string } | null)?.slug ?? '',
      role,
    };
  }

  async updateOrgMembershipRole(
    userId: string,
    organizationId: string,
    role: OrgRole,
    actorUserId: string,
  ) {
    if (!ORG_ROLES.includes(role)) {
      throw new BadRequestException(`Invalid role: ${role}`);
    }
    const { data, error } = await this.supabase.service
      .from('organization_members')
      .update({ role })
      .eq('user_id', userId)
      .eq('organization_id', organizationId)
      .select('id')
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('Membership not found');
    await this.writeAuditLog(actorUserId, 'user.org_membership.update', 'user', userId, {
      organization_id: organizationId,
      role,
    });
    return { userId, organizationId, role };
  }

  async removeOrgMembership(userId: string, organizationId: string, actorUserId: string) {
    const { data, error } = await this.supabase.service
      .from('organization_members')
      .delete()
      .eq('user_id', userId)
      .eq('organization_id', organizationId)
      .select('id')
      .maybeSingle();
    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException('Membership not found');
    await this.writeAuditLog(actorUserId, 'user.org_membership.remove', 'user', userId, {
      organization_id: organizationId,
    });
    return { userId, organizationId };
  }

  private async fetchOrgMembershipsByUser(
    userIds: string[],
  ): Promise<Map<string, UserOrgMembership[]>> {
    if (userIds.length === 0) return new Map();
    const { data, error } = await this.supabase.service
      .from('organization_members')
      .select('user_id, role, organizations(id, name, slug)')
      .in('user_id', userIds);
    if (error) {
      this.logger.warn(`Could not fetch org memberships: ${error.message}`);
      return new Map();
    }
    const map = new Map<string, UserOrgMembership[]>();
    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      const userId = row['user_id'] as string;
      const org = row['organizations'] as { id?: string; name?: string; slug?: string } | null;
      if (!org?.id) continue;
      const entry: UserOrgMembership = {
        id: org.id,
        name: org.name ?? '',
        slug: org.slug ?? '',
        role: (row['role'] as OrgRole) ?? 'read_only',
      };
      const list = map.get(userId) ?? [];
      list.push(entry);
      map.set(userId, list);
    }
    return map;
  }

  async createPlatformUser(input: CreatePlatformUserDto, actorUserId: string) {
    const temporaryPassword = randomBytes(18).toString('base64url');
    const email = input.email.trim().toLowerCase();
    const displayName = input.displayName?.trim();

    const response = await this.supabase.createAuthAdminUser({
      email,
      password: temporaryPassword,
      email_confirm: true,
      user_metadata: displayName ? { display_name: displayName } : undefined,
    });
    if (!response.ok || !response.data?.id) {
      this.logger.warn(`Could not create Auth user through GoTrue: ${response.status}`);
      throw new BadRequestException('Could not create platform account');
    }

    if (input.makeSuperAdmin === true) {
      await this.grantSuperAdmin(response.data.id);
    }

    // Vault the temp password so a super-admin can re-reveal it on the
    // user-detail page until the user changes it themselves. The
    // `supabase_updated_at` baseline is what lets the reveal endpoint
    // detect "the user has set their own password" without a webhook.
    const supabaseUpdatedAt = response.data.updated_at ?? new Date().toISOString();
    await this.supabase.service.from('admin_user_temp_passwords').upsert(
      {
        user_id: response.data.id,
        password: temporaryPassword,
        supabase_updated_at: supabaseUpdatedAt,
      },
      { onConflict: 'user_id' },
    );

    await this.writeAuditLog(actorUserId, 'user.create', 'user', response.data.id, {
      target_email: email,
      super_admin_granted: input.makeSuperAdmin === true,
    });

    return {
      user: {
        id: response.data.id,
        email: response.data.email ?? email,
        created: true,
      },
      temporaryPassword,
      superAdminGranted: input.makeSuperAdmin === true,
    };
  }

  /**
   * Reveal the temp password for a freshly-created user. Resolves to
   * one of three statuses:
   *   - 'active'           — password still valid, returned to caller.
   *   - 'password_changed' — Supabase Auth updated_at has moved past
   *                          the baseline we recorded; row wiped.
   *   - 'expired'          — row missing (never created or already
   *                          locked via the explicit lock endpoint).
   *
   * The original migration shipped with a 7-day wall-clock TTL on the
   * vault row; operators kept hitting it whenever the new user took
   * longer than a week to log in (vacation, slow rollout). Migration
   * 0093 dropped that column; lock is now action-driven only —
   * either the user changes their password, or the super admin hits
   * the explicit lock endpoint.
   *
   * Every successful reveal writes `user.temp_password.reveal` to the
   * audit log. The plaintext is never logged.
   */
  async revealTempPassword(
    userId: string,
    actorUserId: string,
  ): Promise<{ status: 'active'; password: string } | { status: 'password_changed' | 'expired' }> {
    const { data: row } = await this.supabase.service
      .from('admin_user_temp_passwords')
      .select('password, supabase_updated_at')
      .eq('user_id', userId)
      .maybeSingle();

    if (!row) return { status: 'expired' };
    const stored = row as {
      password: string;
      supabase_updated_at: string;
    };

    // Pull current Supabase state to detect a password change since we
    // vaulted. The fetch is on the GoTrue admin API; same surface used
    // by listUsers.
    const fresh = await this.supabase.getAuthAdminUser(userId);
    const currentUpdatedAt = fresh.data?.updated_at;
    if (
      currentUpdatedAt &&
      new Date(currentUpdatedAt).getTime() > new Date(stored.supabase_updated_at).getTime()
    ) {
      await this.wipeTempPasswordRow(userId);
      return { status: 'password_changed' };
    }

    await this.writeAuditLog(actorUserId, 'user.temp_password.reveal', 'user', userId, {});
    return { status: 'active', password: stored.password };
  }

  /**
   * Super-admin lock: wipe the temp password row even if the user
   * hasn't changed their password yet. Used when the admin decides the
   * temp credential has been over-shared.
   */
  async lockTempPassword(userId: string, actorUserId: string): Promise<{ status: 'locked' }> {
    await this.wipeTempPasswordRow(userId);
    await this.writeAuditLog(actorUserId, 'user.temp_password.lock', 'user', userId, {});
    return { status: 'locked' };
  }

  private async wipeTempPasswordRow(userId: string): Promise<void> {
    await this.supabase.service.from('admin_user_temp_passwords').delete().eq('user_id', userId);
  }

  async disableUser(userId: string, actorUserId: string): Promise<void> {
    await this.updateBan(userId, '876000h', actorUserId, 'user.disable');
  }

  async enableUser(userId: string, actorUserId: string): Promise<void> {
    await this.updateBan(userId, 'none', actorUserId, 'user.enable');
  }

  async deletePlatformUser(
    userId: string,
    actorUserId: string,
    mode: DeletePlatformUserMode,
  ): Promise<{ deleted: true; mode: DeletePlatformUserMode; cleanupApplied: boolean }> {
    if (userId === actorUserId) {
      throw new BadRequestException('You cannot delete your own account');
    }

    await this.ensureNotLastSuperAdmin(userId);
    const blockers = await this.collectDeletionBlockers(userId);
    if (blockers.soleOwnerOrganizationIds.length > 0) {
      throw new BadRequestException({
        message: 'This account owns organizations that would be left without an owner',
        blockers,
      });
    }

    if (mode === 'safe' && this.hasDeletionBlockers(blockers)) {
      throw new BadRequestException({
        message: 'This account still has MyClash references and cannot be safely deleted',
        blockers,
      });
    }

    if (mode === 'cleanup') {
      await this.cleanupUserReferences(userId);
    }

    const response = await this.supabase.deleteAuthAdminUser(userId);
    if (!response.ok) {
      this.logger.warn(`Could not delete Auth user through GoTrue: ${response.status}`);
      throw new BadRequestException('Could not delete platform account');
    }

    await this.writeAuditLog(actorUserId, 'user.delete', 'user', userId, {
      mode,
      cleanup_applied: mode === 'cleanup',
    });
    return { deleted: true, mode, cleanupApplied: mode === 'cleanup' };
  }

  async promoteSuperAdmin(userId: string, actorUserId: string): Promise<void> {
    const response = await this.supabase.getAuthAdminUser(userId);
    if (!response.ok || !response.data?.id) throw new BadRequestException('User not found');

    await this.grantSuperAdmin(userId);
    await this.writeAuditLog(actorUserId, 'user.promote_super_admin', 'user', userId, {
      target_email: response.data.email,
    });
  }

  async revokeSuperAdmin(userId: string, actorUserId: string): Promise<void> {
    if (userId === actorUserId) {
      throw new BadRequestException('You cannot revoke your own super admin role');
    }

    await this.ensureNotLastSuperAdmin(userId);
    const { error } = await this.supabase.service
      .from('platform_roles')
      .delete()
      .eq('user_id', userId)
      .eq('role', 'super_admin');
    if (error) throw new BadRequestException(error.message);

    await this.writeAuditLog(actorUserId, 'user.revoke_super_admin', 'user', userId, {});
  }

  async listSuperAdmins(): Promise<Array<{ userId: string; createdAt: string }>> {
    const { data, error } = await this.supabase.service
      .from('platform_roles')
      .select('user_id, created_at')
      .eq('role', 'super_admin');
    if (error) throw new BadRequestException(error.message);
    return (data ?? []).map((r) => ({
      userId: r['user_id'] as string,
      createdAt: r['created_at'] as string,
    }));
  }

  private async grantSuperAdmin(userId: string): Promise<void> {
    const { error } = await this.supabase.service
      .from('platform_roles')
      .upsert({ user_id: userId, role: 'super_admin' }, { onConflict: 'user_id' });
    if (error) throw new BadRequestException(error.message);
  }

  private async updateBan(
    userId: string,
    banDuration: string,
    actorUserId: string,
    action: string,
  ): Promise<void> {
    const response = await this.supabase.updateAuthAdminUser(userId, {
      ban_duration: banDuration,
    });
    if (!response.ok) throw new BadRequestException('Could not update platform account');

    await this.writeAuditLog(actorUserId, action, 'user', userId, {
      ban_duration: banDuration,
    });
  }

  private async ensureNotLastSuperAdmin(userId: string): Promise<void> {
    const superAdmins = await this.listSuperAdmins();
    const targetIsSuperAdmin = superAdmins.some((admin) => admin.userId === userId);
    if (targetIsSuperAdmin && superAdmins.length <= 1) {
      throw new BadRequestException('You cannot remove the last remaining super admin');
    }
  }

  private hasDeletionBlockers(blockers: UserDeletionBlockers): boolean {
    return (
      blockers.soleOwnerOrganizationIds.length > 0 ||
      Object.values(blockers.references).some((count) => count > 0)
    );
  }

  private async collectDeletionBlockers(userId: string): Promise<UserDeletionBlockers> {
    const referenceChecks: Array<{ key: string; table: string; column: string }> = [
      { key: 'platform_roles', table: 'platform_roles', column: 'user_id' },
      { key: 'organization_members', table: 'organization_members', column: 'user_id' },
      { key: 'push_subscriptions', table: 'push_subscriptions', column: 'user_id' },
      { key: 'notification_preferences', table: 'notification_preferences', column: 'user_id' },
      { key: 'follows', table: 'follows', column: 'follower_user_id' },
      { key: 'persons', table: 'persons', column: 'claimed_by_user_id' },
      { key: 'global_persons', table: 'global_persons', column: 'claimed_by_user_id' },
      { key: 'workshop_enrollments', table: 'workshop_enrollments', column: 'user_id' },
      { key: 'referee_qualifications', table: 'referee_qualifications', column: 'user_id' },
      { key: 'event_broadcast_recipients', table: 'event_broadcast_recipients', column: 'user_id' },
    ];

    const references: Record<string, number> = {};
    for (const check of referenceChecks) {
      references[check.key] = await this.countReferences(check.table, check.column, userId);
    }

    return {
      references,
      soleOwnerOrganizationIds: await this.findSoleOwnerOrganizationIds(userId),
    };
  }

  private async countReferences(table: string, column: string, userId: string): Promise<number> {
    const { data, error } = await this.supabase.service
      .from(table)
      .select(column)
      .eq(column, userId);
    if (error) throw new BadRequestException(`Could not inspect ${table} references`);
    return Array.isArray(data) ? data.length : 0;
  }

  private async findSoleOwnerOrganizationIds(userId: string): Promise<string[]> {
    const { data: memberships, error } = await this.supabase.service
      .from('organization_members')
      .select('organization_id')
      .eq('user_id', userId)
      .eq('role', 'owner');
    if (error) throw new BadRequestException('Could not inspect organization ownership');

    const soleOwnerOrganizationIds: string[] = [];
    for (const membership of memberships ?? []) {
      const organizationId = membership['organization_id'] as string;
      const { data: owners, error: ownersError } = await this.supabase.service
        .from('organization_members')
        .select('user_id')
        .eq('organization_id', organizationId)
        .eq('role', 'owner');
      if (ownersError) throw new BadRequestException('Could not inspect organization ownership');
      if ((owners ?? []).length <= 1) soleOwnerOrganizationIds.push(organizationId);
    }

    return soleOwnerOrganizationIds;
  }

  private async cleanupUserReferences(userId: string): Promise<void> {
    const deletions: Array<{ table: string; column: string }> = [
      { table: 'platform_roles', column: 'user_id' },
      { table: 'organization_members', column: 'user_id' },
      { table: 'push_subscriptions', column: 'user_id' },
      { table: 'notification_preferences', column: 'user_id' },
      { table: 'follows', column: 'follower_user_id' },
      { table: 'workshop_enrollments', column: 'user_id' },
      { table: 'referee_qualifications', column: 'user_id' },
      { table: 'event_broadcast_recipients', column: 'user_id' },
    ];

    for (const deletion of deletions) {
      const { error } = await this.supabase.service
        .from(deletion.table)
        .delete()
        .eq(deletion.column, userId);
      if (error) throw new BadRequestException(`Could not clean up ${deletion.table}`);
    }

    const { error: personsError } = await this.supabase.service
      .from('persons')
      .update({ claimed_by_user_id: null, claim_status: 'unclaimed' })
      .eq('claimed_by_user_id', userId);
    if (personsError) throw new BadRequestException('Could not unlink event persons');

    const { error: globalPersonsError } = await this.supabase.service
      .from('global_persons')
      .update({ claimed_by_user_id: null })
      .eq('claimed_by_user_id', userId);
    if (globalPersonsError) throw new BadRequestException('Could not unlink global persons');
  }

  private async writeAuditLog(
    actorUserId: string,
    action: string,
    entityType: string,
    entityId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.supabase.service.from('audit_log').insert({
        actor_user_id: actorUserId,
        action,
        entity_type: entityType,
        entity_id: entityId,
        payload_json: payload,
      });
    } catch {
      this.logger.warn(`Could not write audit log for ${action} on ${entityType}:${entityId}`);
    }
  }

  /**
   * Enumerate `auth.users` (paged) and apply the scope + search filters
   * in-app, then paginate. Used for the staff scope and for any search.
   *
   * The staff predicate is evaluated from two id-only sets (super-admins and
   * org members) so we never build a huge PostgREST `.in(...)` over every
   * auth user. Detailed org membership (names/roles) is fetched only for the
   * final page slice.
   */
  private async listMaterialized(opts: {
    scope: 'staff' | 'all';
    search?: string;
    page: number;
    perPage: number;
  }) {
    const normalizedSearch = opts.search ? normalizeSearch(opts.search) : null;
    const [superAdminIds, orgMemberIds] = await Promise.all([
      this.fetchSuperAdminIds(),
      opts.scope === 'staff' ? this.fetchAllOrgMemberUserIds() : Promise.resolve(new Set<string>()),
    ]);

    const matched: ListedPlatformUser[] = [];
    let currentPage = 1;
    const authPageSize = 1000;

    while (currentPage <= 10) {
      const response = await this.supabase.listAuthAdminUsers(currentPage, authPageSize);
      if (!response.ok || !response.data) {
        this.logger.warn(`Could not list Auth users through GoTrue: ${response.status}`);
        throw new BadRequestException('Could not inspect platform accounts');
      }

      for (const user of response.data.users) {
        const isSuperAdmin = superAdminIds.has(user.id);
        if (opts.scope === 'staff' && !isSuperAdmin && !orgMemberIds.has(user.id)) continue;
        // Org membership details are annotated on the final slice below.
        const listedUser = this.toListedUser(user, undefined, isSuperAdmin);
        if (normalizedSearch && !this.userMatchesSearch(listedUser, normalizedSearch)) continue;
        matched.push(listedUser);
      }

      if (response.data.users.length < authPageSize) break;
      currentPage += 1;
    }

    if (normalizedSearch) {
      matched.sort((a, b) => {
        const aScore = this.userSearchScore(a, normalizedSearch);
        const bScore = this.userSearchScore(b, normalizedSearch);
        if (aScore !== bScore) return bScore - aScore;
        return (a.email ?? a.id).localeCompare(b.email ?? b.id);
      });
    } else {
      matched.sort((a, b) => (a.email ?? a.id).localeCompare(b.email ?? b.id));
    }

    const start = Math.max(opts.page - 1, 0) * opts.perPage;
    const slice = matched.slice(start, start + opts.perPage);
    const orgsByUser = await this.fetchOrgMembershipsByUser(slice.map((u) => u.id));
    return {
      users: slice.map((u) => ({
        ...u,
        organizations: orgsByUser.get(u.id) ?? [],
      })),
    };
  }

  /**
   * All distinct `auth.users` ids that hold at least one organization
   * membership. Used as the staff-scope predicate.
   *
   * NOTE: relies on PostgREST's default 1000-row cap. Fine at current scale;
   * switch to a `.range()` loop if org membership ever exceeds 1000 rows.
   */
  private async fetchAllOrgMemberUserIds(): Promise<Set<string>> {
    const { data, error } = await this.supabase.service
      .from('organization_members')
      .select('user_id');
    if (error) {
      this.logger.warn(`Could not fetch org member ids: ${error.message}`);
      return new Set();
    }
    return new Set(
      (data ?? [])
        .map((row) => (row as { user_id?: string }).user_id)
        .filter((id): id is string => typeof id === 'string'),
    );
  }

  private toListedUser(
    user: SupabaseAdminUser,
    organizations: UserOrgMembership[] = [],
    isSuperAdmin = false,
  ): ListedPlatformUser {
    return {
      ...user,
      display_name: this.normalizeDisplayName(user),
      organizations,
      is_super_admin: isSuperAdmin,
    };
  }

  private async fetchSuperAdminIds(): Promise<Set<string>> {
    const admins = await this.listSuperAdmins();
    return new Set(admins.map((admin) => admin.userId));
  }

  /** Throws if `userId` holds the platform-level super-admin role. */
  private async assertNotSuperAdmin(userId: string): Promise<void> {
    const { data } = await this.supabase.service
      .from('platform_roles')
      .select('user_id')
      .eq('user_id', userId)
      .eq('role', 'super_admin')
      .maybeSingle();
    if (data) {
      throw new ForbiddenException(
        'Cannot add a super-admin to an organization. Revoke super-admin status first.',
      );
    }
  }

  private userMatchesSearch(user: ListedPlatformUser, normalizedSearch: string): boolean {
    return this.userSearchTokens(user).some((token) => token.includes(normalizedSearch));
  }

  private userSearchScore(user: ListedPlatformUser, normalizedSearch: string): number {
    let score = 0;
    for (const token of this.userSearchTokens(user)) {
      if (token === normalizedSearch) score = Math.max(score, 100);
      else if (token.startsWith(normalizedSearch)) score = Math.max(score, 75);
      else if (token.includes(normalizedSearch)) score = Math.max(score, 50);
    }
    return score;
  }

  private userSearchTokens(user: ListedPlatformUser): string[] {
    return [user.display_name, user.email, user.id].filter(Boolean).map((value) => {
      return normalizeSearch(String(value));
    });
  }

  /**
   * Resolve a human-readable name for the account. Explicit `display_name`
   * (set via the admin form) wins; otherwise we fall back to the name fields
   * that OAuth providers populate on first sign-in (Google sets `full_name`
   * and `name`, sometimes `given_name`/`family_name`), so a self-signup login
   * shows its real name instead of a blank cell.
   */
  private normalizeDisplayName(user: SupabaseAdminUser): ListedPlatformUser['display_name'] {
    const metadata = user.user_metadata ?? {};
    const candidates: unknown[] = [
      metadata['display_name'],
      metadata['full_name'],
      metadata['name'],
      joinName(metadata['given_name'], metadata['family_name']),
    ];
    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
    }
    return null;
  }
}

function joinName(given: unknown, family: unknown): string {
  return [given, family]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .map((part) => part.trim())
    .join(' ');
}

function normalizeSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}
