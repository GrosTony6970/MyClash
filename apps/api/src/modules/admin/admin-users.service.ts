import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { CreatePlatformUserDto } from './dto/admin-users.dto';
import { SupabaseService, type SupabaseAdminUser } from '../supabase/supabase.service';

export interface ListUsersQuery {
  page?: number;
  perPage?: number;
  q?: string;
}

export type DeletePlatformUserMode = 'safe' | 'cleanup';

interface UserDeletionBlockers {
  references: Record<string, number>;
  soleOwnerOrganizationIds: string[];
}

type ListedPlatformUser = SupabaseAdminUser & { display_name: string | null };

@Injectable()
export class AdminUsersService {
  private readonly logger = new Logger(AdminUsersService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async listUsers(query: ListUsersQuery = {}) {
    const page = query.page ?? 1;
    const perPage = query.perPage ?? 50;
    const search = query.q?.trim();
    if (search) return this.searchUsers(search, page, perPage);

    const response = await this.supabase.listAuthAdminUsers(page, perPage);
    if (!response.ok || !response.data) {
      this.logger.warn(`Could not list Auth users through GoTrue: ${response.status}`);
      throw new BadRequestException('Could not inspect platform accounts');
    }
    return {
      users: response.data.users.map((user) => this.toListedUser(user)),
    };
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

  private async searchUsers(search: string, page: number, perPage: number) {
    const normalizedSearch = normalizeSearch(search);
    const users: ListedPlatformUser[] = [];
    let currentPage = 1;
    const authPageSize = 1000;

    while (currentPage <= 10) {
      const response = await this.supabase.listAuthAdminUsers(currentPage, authPageSize);
      if (!response.ok || !response.data) {
        this.logger.warn(`Could not search Auth users through GoTrue: ${response.status}`);
        throw new BadRequestException('Could not inspect platform accounts');
      }

      for (const user of response.data.users) {
        const listedUser = this.toListedUser(user);
        if (this.userMatchesSearch(listedUser, normalizedSearch)) users.push(listedUser);
      }

      if (response.data.users.length < authPageSize) break;
      currentPage += 1;
    }

    users.sort((a, b) => {
      const aScore = this.userSearchScore(a, normalizedSearch);
      const bScore = this.userSearchScore(b, normalizedSearch);
      if (aScore !== bScore) return bScore - aScore;
      return (a.email ?? a.id).localeCompare(b.email ?? b.id);
    });

    const start = Math.max(page - 1, 0) * perPage;
    return { users: users.slice(start, start + perPage) };
  }

  private toListedUser(user: SupabaseAdminUser): ListedPlatformUser {
    return {
      ...user,
      display_name: this.normalizeDisplayName(user),
    };
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

  private normalizeDisplayName(user: SupabaseAdminUser): ListedPlatformUser['display_name'] {
    const displayName = user.user_metadata?.['display_name'];
    return typeof displayName === 'string' && displayName.trim() ? displayName.trim() : null;
  }
}

function normalizeSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}
