import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import { MailService } from '../mail/mail.service';
import { RESERVED_SLUGS } from '../organizations/dto/signup.dto';
import { SupabaseService } from '../supabase/supabase.service';
import type {
  CreateOrganizationDto,
  ListOrgsQueryDto,
  PromoteSuperAdminDto,
  ReassignOwnerDto,
} from './dto/admin-organizations.dto';

const PROTECTED_ORG_SLUG = 'myclash-hq';

interface AuthUserDisplay {
  email?: string;
  displayName?: string;
  username: string;
}

/** Shape returned for each org in the list view. */
export interface OrgListItem {
  id: string;
  name: string;
  slug: string;
  status: 'active' | 'suspended';
  owner_email: string | null;
  owner_name: string | null;
  owner_username: string | null;
  member_count: number;
  event_count: number;
  created_at: string;
  last_activity: string | null;
  is_protected: boolean;
}

/** Shape returned for the org detail view. */
export interface OrgDetail extends OrgListItem {
  members: Array<{
    user_id: string;
    email: string;
    display_name: string | null;
    username: string;
    role: string;
    joined_at: string;
  }>;
  recent_audit_log: Array<{
    id: string;
    actor_user_id: string;
    action: string;
    entity_type: string;
    entity_id: string;
    created_at: string;
  }>;
}

export interface CreateOrganizationResult {
  organization: {
    id: string;
    name: string;
    slug: string;
    status: 'active' | 'suspended';
  };
  owner: {
    userId: string;
    email: string;
    created: boolean;
    temporaryPassword?: string;
  };
  membership: {
    role: 'owner';
  };
  magicLinkSent: boolean;
}

@Injectable()
export class AdminOrganizationsService {
  private readonly logger = new Logger(AdminOrganizationsService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly mail?: MailService,
    private readonly config?: ConfigService,
  ) {}

  // ── List ────────────────────────────────────────────────────────────────

  async createOrganizationWithOwner(
    dto: CreateOrganizationDto,
    actorUserId: string,
  ): Promise<CreateOrganizationResult> {
    const slug = dto.slug.trim().toLowerCase();
    const ownerEmail = dto.ownerEmail.trim().toLowerCase();
    const ownerDisplayName = dto.ownerDisplayName?.trim() || ownerEmail;

    await this.ensureSlugAvailable(slug);

    let authUser = await this.findAuthUserByEmail(ownerEmail);
    let ownerCreated = false;
    let temporaryPassword: string | undefined;
    let createdOrgId: string | undefined;

    if (!authUser) {
      temporaryPassword = this.generateTemporaryPassword();
      const response = await this.supabase.createAuthAdminUser({
        email: ownerEmail,
        password: temporaryPassword,
        email_confirm: true,
        user_metadata: { display_name: ownerDisplayName },
      });

      if (!response.ok || !response.data) {
        if (this.isAlreadyExistsResponse(response.detail)) {
          authUser = await this.findAuthUserByEmail(ownerEmail);
        }
        if (!authUser) {
          this.logger.error(
            `Failed to create organizer account for ${ownerEmail}: ${this.formatGoTrueDetail(
              response,
            )}`,
          );
          throw new BadRequestException('Failed to create organizer account');
        }
      } else {
        authUser = { id: response.data.id, email: response.data.email ?? ownerEmail };
        ownerCreated = true;
      }
    }

    try {
      const { data: org, error: orgError } = await this.supabase.service
        .from('organizations')
        .insert({
          name: dto.name.trim(),
          slug,
          status: 'active',
          created_by_user_id: authUser.id,
        })
        .select('id, name, slug, status')
        .single();

      if (orgError || !org) {
        throw new Error(orgError?.message ?? 'Organization insert returned no row');
      }

      const organization = org as CreateOrganizationResult['organization'];
      createdOrgId = organization.id;

      const { error: memberError } = await this.supabase.service
        .from('organization_members')
        .insert({
          organization_id: organization.id,
          user_id: authUser.id,
          role: 'owner',
        });

      if (memberError) {
        throw new Error(`Failed to create owner membership: ${memberError.message}`);
      }

      await this.writeAuditLog(
        actorUserId,
        'org.create_with_owner',
        'organization',
        organization.id,
        {
          slug,
          owner_user_id: authUser.id,
          owner_created: ownerCreated,
        },
      );

      const magicLinkSent = await this.trySendOwnerMagicLink(
        ownerEmail,
        ownerDisplayName,
        organization.slug,
      );

      return {
        organization,
        owner: {
          userId: authUser.id,
          email: authUser.email ?? ownerEmail,
          created: ownerCreated,
          ...(ownerCreated && temporaryPassword ? { temporaryPassword } : {}),
        },
        membership: { role: 'owner' },
        magicLinkSent,
      };
    } catch (err) {
      await this.cleanupFailedCreate(createdOrgId, ownerCreated ? authUser.id : undefined);
      this.logger.error(`Failed to create organization ${slug}: ${String(err)}`);
      throw new BadRequestException('Failed to create organization');
    }
  }

  async listOrganizations(query: ListOrgsQueryDto): Promise<OrgListItem[]> {
    try {
      let q = this.supabase.service.from('organizations').select(`
          id, name, slug, status, created_at,
          organization_members!inner(user_id, role),
          events(id)
        `);

      if (query.status) q = q.eq('status', query.status) as typeof q;
      if (query.q) q = q.ilike('name', `%${query.q}%`) as typeof q;

      const { data, error } = await q;
      if (error) throw error;

      const rows = (data ?? []) as Array<Record<string, unknown>>;
      const userIds = new Set<string>();
      for (const org of rows) {
        const members =
          (org['organization_members'] as Array<{ user_id: string; role: string }>) ?? [];
        for (const member of members) userIds.add(member.user_id);
      }
      const usersById = await this.getAuthUserDisplayMap(userIds);

      // Flatten into OrgListItem shape
      return rows.map((org) => {
        const members =
          (org['organization_members'] as Array<{ user_id: string; role: string }>) ?? [];
        const ownerMember = members.find((m) => m.role === 'owner');
        const ownerUser = ownerMember ? usersById.get(ownerMember.user_id) : null;
        return {
          id: org['id'] as string,
          name: org['name'] as string,
          slug: org['slug'] as string,
          status: org['status'] as 'active' | 'suspended',
          owner_email: ownerUser?.email ?? (ownerMember ? `user:${ownerMember.user_id}` : null),
          owner_name: ownerUser?.displayName ?? null,
          owner_username:
            ownerUser?.username ?? (ownerMember ? `user:${ownerMember.user_id}` : null),
          member_count: members.length,
          event_count: ((org['events'] as unknown[]) ?? []).length,
          created_at: org['created_at'] as string,
          last_activity: null,
          is_protected: org['slug'] === PROTECTED_ORG_SLUG,
        };
      });
    } catch {
      // Table not yet created (pre-T-101)
      this.logger.warn('organizations table not yet available');
      return [];
    }
  }

  // ── Detail ───────────────────────────────────────────────────────────────

  async getOrganization(id: string): Promise<OrgDetail> {
    try {
      const { data: org, error } = await this.supabase.service
        .from('organizations')
        .select(
          `
          id, name, slug, status, created_at,
          organization_members(user_id, role, created_at),
          events(id)
        `,
        )
        .eq('id', id)
        .maybeSingle();

      if (error) throw error;
      if (!org) throw new NotFoundException(`Organization ${id} not found`);

      const members =
        ((org as Record<string, unknown>)['organization_members'] as Array<{
          user_id: string;
          role: string;
          created_at: string;
        }>) ?? [];
      const usersById = await this.getAuthUserDisplayMap(
        new Set(members.map((member) => member.user_id)),
      );
      const ownerMember = members.find((member) => member.role === 'owner');
      const ownerUser = ownerMember ? usersById.get(ownerMember.user_id) : null;

      // Fetch recent audit log entries
      let auditLog: OrgDetail['recent_audit_log'] = [];
      try {
        const { data: logs } = await this.supabase.service
          .from('audit_log')
          .select('id, actor_user_id, action, entity_type, entity_id, created_at')
          .eq('entity_type', 'organization')
          .eq('entity_id', id)
          .order('created_at', { ascending: false })
          .limit(20);
        auditLog = (logs ?? []) as OrgDetail['recent_audit_log'];
      } catch {
        // audit_log table not yet created
      }

      const o = org as Record<string, unknown>;
      return {
        id: o['id'] as string,
        name: o['name'] as string,
        slug: o['slug'] as string,
        status: o['status'] as 'active' | 'suspended',
        owner_email: ownerUser?.email ?? (ownerMember ? `user:${ownerMember.user_id}` : null),
        owner_name: ownerUser?.displayName ?? null,
        owner_username: ownerUser?.username ?? (ownerMember ? `user:${ownerMember.user_id}` : null),
        member_count: members.length,
        event_count: ((o['events'] as unknown[]) ?? []).length,
        created_at: o['created_at'] as string,
        last_activity: null,
        is_protected: o['slug'] === PROTECTED_ORG_SLUG,
        members: members.map((m) => ({
          user_id: m.user_id,
          email: usersById.get(m.user_id)?.email ?? `user:${m.user_id}`,
          display_name: usersById.get(m.user_id)?.displayName ?? null,
          username: usersById.get(m.user_id)?.username ?? `user:${m.user_id}`,
          role: m.role,
          joined_at: m.created_at,
        })),
        recent_audit_log: auditLog,
      };
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      this.logger.warn(`Could not fetch org ${id}: ${String(err)}`);
      throw new NotFoundException(`Organization ${id} not found`);
    }
  }

  // ── Suspend ──────────────────────────────────────────────────────────────

  async suspendOrganization(id: string, actorUserId: string): Promise<void> {
    await this.ensureOrganizationCanBeSuspended(id);
    await this.updateStatus(id, 'suspended', actorUserId, 'org.suspend');
  }

  // ── Reactivate ───────────────────────────────────────────────────────────

  async reactivateOrganization(id: string, actorUserId: string): Promise<void> {
    await this.updateStatus(id, 'active', actorUserId, 'org.reactivate');
  }

  async approveOrganization(id: string, actorUserId: string): Promise<void> {
    await this.updateStatus(id, 'active', actorUserId, 'org.approve');
  }

  // ── Delete (hard) ────────────────────────────────────────────────────────

  async deleteOrganization(id: string, actorUserId: string): Promise<void> {
    try {
      await this.ensureOrganizationCanBeDeleted(id);

      // Ensure a <deleted> placeholder org exists for data preservation
      await this.ensureDeletedPlaceholder();

      // Log before deletion
      await this.writeAuditLog(actorUserId, 'org.delete', 'organization', id, { hard: true });

      const { error } = await this.supabase.service.from('organizations').delete().eq('id', id);

      if (error) throw error;
      this.logger.log(`Organization ${id} hard-deleted by ${actorUserId}`);
    } catch (err) {
      if (err instanceof BadRequestException || err instanceof NotFoundException) throw err;
      this.logger.error(`Failed to delete org ${id}: ${String(err)}`);
      throw new BadRequestException('Failed to delete organization');
    }
  }

  // ── Promote to super_admin ───────────────────────────────────────────────

  async promoteSuperAdmin(dto: PromoteSuperAdminDto, actorUserId: string): Promise<void> {
    try {
      const { error } = await this.supabase.service
        .from('platform_roles')
        .upsert({ user_id: dto.userId, role: 'super_admin' });

      if (error) throw error;

      await this.writeAuditLog(actorUserId, 'user.promote_super_admin', 'user', dto.userId, {});
      this.logger.log(`User ${dto.userId} promoted to super_admin by ${actorUserId}`);
    } catch (err) {
      this.logger.error(`Failed to promote ${dto.userId}: ${String(err)}`);
      throw new BadRequestException('Failed to promote user');
    }
  }

  // ── Reassign ownership ───────────────────────────────────────────────────

  async reassignOwner(orgId: string, dto: ReassignOwnerDto, actorUserId: string): Promise<void> {
    try {
      // Verify new owner is an existing member
      const { data: member } = await this.supabase.service
        .from('organization_members')
        .select('user_id')
        .eq('organization_id', orgId)
        .eq('user_id', dto.newOwnerUserId)
        .maybeSingle();

      if (!member) {
        throw new BadRequestException('New owner must be an existing member of the organization');
      }

      // Demote current owner(s) to admin
      await this.supabase.service
        .from('organization_members')
        .update({ role: 'admin' })
        .eq('organization_id', orgId)
        .eq('role', 'owner');

      // Promote new owner
      await this.supabase.service
        .from('organization_members')
        .update({ role: 'owner' })
        .eq('organization_id', orgId)
        .eq('user_id', dto.newOwnerUserId);

      await this.writeAuditLog(actorUserId, 'org.reassign_owner', 'organization', orgId, {
        new_owner_user_id: dto.newOwnerUserId,
      });

      this.logger.log(
        `Org ${orgId} ownership reassigned to ${dto.newOwnerUserId} by ${actorUserId}`,
      );
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      this.logger.error(`Failed to reassign owner for org ${orgId}: ${String(err)}`);
      throw new BadRequestException('Failed to reassign ownership');
    }
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private async updateStatus(
    id: string,
    status: 'active' | 'suspended',
    actorUserId: string,
    action: string,
  ): Promise<void> {
    try {
      const { error } = await this.supabase.service
        .from('organizations')
        .update({ status })
        .eq('id', id);

      if (error) throw error;

      await this.writeAuditLog(actorUserId, action, 'organization', id, { status });
      this.logger.log(`Organization ${id} status → ${status} by ${actorUserId}`);
    } catch (err) {
      this.logger.error(`Failed to update org ${id} status: ${String(err)}`);
      throw new BadRequestException(`Failed to ${action} organization`);
    }
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
      // audit_log table not yet created (pre-T-101) — non-fatal
      this.logger.warn(`Could not write audit log for ${action} on ${entityType}:${entityId}`);
    }
  }

  private async ensureDeletedPlaceholder(): Promise<void> {
    try {
      const { data } = await this.supabase.service
        .from('organizations')
        .select('id')
        .eq('slug', '__deleted__')
        .maybeSingle();

      if (!data) {
        await this.supabase.service.from('organizations').insert({
          name: '<Deleted Organizations>',
          slug: '__deleted__',
          status: 'suspended',
        });
      }
    } catch {
      // Table not yet created — skip
    }
  }

  private async ensureOrganizationCanBeDeleted(id: string): Promise<void> {
    const { data, error } = await this.supabase.service
      .from('organizations')
      .select('slug')
      .eq('id', id)
      .maybeSingle();

    if (error) throw new BadRequestException('Could not validate organization deletion');
    if (!data) throw new NotFoundException(`Organization ${id} not found`);
    if ((data as { slug?: string }).slug === PROTECTED_ORG_SLUG) {
      throw new BadRequestException('The MyClash HQ organization cannot be deleted');
    }
  }

  private async ensureOrganizationCanBeSuspended(id: string): Promise<void> {
    const { data, error } = await this.supabase.service
      .from('organizations')
      .select('slug')
      .eq('id', id)
      .maybeSingle();

    if (error) throw new BadRequestException('Could not validate organization suspension');
    if (!data) throw new NotFoundException(`Organization ${id} not found`);
    if ((data as { slug?: string }).slug === PROTECTED_ORG_SLUG) {
      throw new BadRequestException('The MyClash HQ organization cannot be suspended');
    }
  }

  private async ensureSlugAvailable(slug: string): Promise<void> {
    if ((RESERVED_SLUGS as readonly string[]).includes(slug)) {
      throw new ConflictException(`The slug "${slug}" is reserved`);
    }

    const { data, error } = await this.supabase.service
      .from('organizations')
      .select('id')
      .eq('slug', slug)
      .maybeSingle();

    if (error) throw new BadRequestException('Could not validate organization slug');
    if (data) throw new ConflictException(`The slug "${slug}" is already taken`);
  }

  private async findAuthUserByEmail(email: string): Promise<{ id: string; email?: string } | null> {
    const target = email.toLowerCase();
    let page = 1;
    const perPage = 1000;

    while (page <= 10) {
      const response = await this.supabase.listAuthAdminUsers(page, perPage);
      if (!response.ok || !response.data) {
        this.logger.warn(
          `Could not inspect organizer accounts via internal GoTrue: ${this.formatGoTrueDetail(
            response,
          )}`,
        );
        throw new BadRequestException('Could not inspect organizer accounts');
      }

      const user = response.data.users.find(
        (candidate) => candidate.email?.toLowerCase() === target,
      );
      if (user) return { id: user.id, email: user.email };
      if (response.data.users.length < perPage) return null;
      page += 1;
    }

    return null;
  }

  private async getAuthUserDisplayMap(userIds: Set<string>): Promise<Map<string, AuthUserDisplay>> {
    const result = new Map<string, AuthUserDisplay>();
    if (userIds.size === 0) return result;

    let page = 1;
    const perPage = 1000;

    while (page <= 10 && result.size < userIds.size) {
      const response = await this.supabase.listAuthAdminUsers(page, perPage);
      if (!response.ok || !response.data) {
        this.logger.warn(
          `Could not enrich organization members via internal GoTrue: ${this.formatGoTrueDetail(
            response,
          )}`,
        );
        return result;
      }

      for (const user of response.data.users) {
        if (!userIds.has(user.id)) continue;
        const displayName =
          typeof user.user_metadata?.['display_name'] === 'string'
            ? user.user_metadata['display_name']
            : undefined;
        result.set(user.id, {
          email: user.email,
          displayName,
          username: displayName || user.email || `user:${user.id}`,
        });
      }

      if (response.data.users.length < perPage) return result;
      page += 1;
    }

    return result;
  }

  private generateTemporaryPassword(): string {
    return randomBytes(18).toString('base64url');
  }

  private async trySendOwnerMagicLink(
    email: string,
    displayName: string,
    orgSlug: string,
  ): Promise<boolean> {
    if (!this.mail) return false;

    const domain = this.config?.get<string>('DOMAIN', 'myclash.localhost') ?? 'myclash.localhost';
    try {
      const { data, error } = await this.supabase.service.auth.admin.generateLink({
        type: 'magiclink',
        email,
        options: {
          redirectTo: `https://admin.${domain}/org/${orgSlug}`,
          data: { display_name: displayName },
        },
      });

      const magicLink = data.properties?.action_link;
      if (error || !magicLink) {
        this.logger.warn(`Could not generate organizer magic link for ${email}: ${error?.message}`);
        return false;
      }

      await this.mail.sendMagicLink({
        to: email,
        magicLink,
        type: 'login',
        displayName,
      });
      return true;
    } catch (err) {
      this.logger.warn(`Could not send organizer magic link for ${email}: ${String(err)}`);
      return false;
    }
  }

  private async cleanupFailedCreate(orgId?: string, newUserId?: string): Promise<void> {
    if (orgId) {
      try {
        await this.supabase.service.from('organizations').delete().eq('id', orgId);
      } catch {
        this.logger.warn(`Could not clean up organization ${orgId} after failed creation`);
      }
    }

    if (newUserId) {
      try {
        const response = await this.supabase.deleteAuthAdminUser(newUserId);
        if (!response.ok) {
          this.logger.warn(
            `Could not clean up organizer user ${newUserId} after failed creation: ${this.formatGoTrueDetail(
              response,
            )}`,
          );
        }
      } catch (err) {
        this.logger.warn(
          `Could not clean up organizer user ${newUserId} after failed creation: ${String(err)}`,
        );
      }
    }
  }

  private isAlreadyExistsResponse(detail: unknown): boolean {
    return JSON.stringify(detail).toLowerCase().includes('already');
  }

  private formatGoTrueDetail(response: { status: number; detail: unknown }): string {
    const detail =
      response.detail && typeof response.detail === 'object'
        ? JSON.stringify(response.detail)
        : String(response.detail ?? 'no response body');
    return `status=${response.status} detail=${detail}`;
  }
}
