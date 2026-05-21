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
  /** Owner details. Null when the org was created without an owner. */
  owner: {
    userId: string;
    email: string;
    created: boolean;
    temporaryPassword?: string;
  } | null;
  /** Membership info. Null when no owner was assigned at creation. */
  membership: {
    role: 'owner';
  } | null;
  magicLinkSent: boolean;
}

export interface AssignOwnerResult {
  ownerUserId: string;
  ownerCreated: boolean;
  magicLinkSent: boolean;
  /** 'org.owner_assigned' when there was no prior owner; 'org.owner_reassigned' otherwise. */
  action: 'org.owner_assigned' | 'org.owner_reassigned';
}

/**
 * Internal shape returned by `bootstrapOwnerAccount` — resolves an owner
 * identity from either an existing userId or an email (creating an auth
 * user when needed). Used by both org creation and assign-owner.
 */
interface BootstrappedOwner {
  userId: string;
  email: string;
  displayName: string;
  created: boolean;
  temporaryPassword?: string;
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
    const hasUserId = !!dto.ownerUserId;
    const hasEmail = !!dto.ownerEmail;
    if (hasUserId && hasEmail) {
      throw new BadRequestException(
        'Provide at most one of ownerUserId or ownerEmail (or omit both to create an org without an owner)',
      );
    }
    const hasOwnerInput = hasUserId || hasEmail;

    await this.ensureSlugAvailable(slug);

    let owner: BootstrappedOwner | null = null;
    let createdOrgId: string | undefined;

    if (hasOwnerInput) {
      owner = await this.bootstrapOwnerAccount(dto);
    }

    try {
      const { data: org, error: orgError } = await this.supabase.service
        .from('organizations')
        .insert({
          name: dto.name.trim(),
          slug,
          status: 'active',
          created_by_user_id: owner?.userId ?? actorUserId,
        })
        .select('id, name, slug, status')
        .single();

      if (orgError || !org) {
        throw new Error(orgError?.message ?? 'Organization insert returned no row');
      }

      const organization = org as CreateOrganizationResult['organization'];
      createdOrgId = organization.id;

      if (owner) {
        const { error: memberError } = await this.supabase.service
          .from('organization_members')
          .insert({
            organization_id: organization.id,
            user_id: owner.userId,
            role: 'owner',
          });

        if (memberError) {
          throw new Error(`Failed to create owner membership: ${memberError.message}`);
        }
      }

      await this.writeAuditLog(
        actorUserId,
        owner ? 'org.create_with_owner' : 'org.create_without_owner',
        'organization',
        organization.id,
        {
          slug,
          owner_user_id: owner?.userId ?? null,
          owner_created: owner?.created ?? false,
        },
      );

      let magicLinkSent = false;
      if (owner) {
        magicLinkSent = await this.trySendOwnerMagicLink(
          owner.email,
          owner.displayName,
          organization.slug,
        );

        if (owner.created && owner.temporaryPassword) {
          await this.trySendOwnerWelcomePassword(
            owner.email,
            owner.displayName,
            organization.name,
            organization.slug,
            owner.temporaryPassword,
          );
        }
      }

      return {
        organization,
        owner: owner
          ? {
              userId: owner.userId,
              email: owner.email,
              created: owner.created,
              ...(owner.created && owner.temporaryPassword
                ? { temporaryPassword: owner.temporaryPassword }
                : {}),
            }
          : null,
        membership: owner ? { role: 'owner' } : null,
        magicLinkSent,
      };
    } catch (err) {
      await this.cleanupFailedCreate(createdOrgId, owner?.created ? owner.userId : undefined);
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

  // ── Update basics ────────────────────────────────────────────────────────

  async updateOrganization(
    id: string,
    dto: { name?: string; slug?: string },
    actorUserId: string,
  ): Promise<{ id: string; name: string; slug: string }> {
    const patch: { name?: string; slug?: string } = {};
    if (dto.name !== undefined) patch.name = dto.name.trim();
    if (dto.slug !== undefined) {
      const slug = dto.slug.trim().toLowerCase();
      const { data: existing } = await this.supabase.service
        .from('organizations')
        .select('id')
        .eq('slug', slug)
        .neq('id', id)
        .maybeSingle();
      if (existing) throw new BadRequestException(`Slug "${slug}" is already in use`);
      patch.slug = slug;
    }
    if (Object.keys(patch).length === 0) {
      const { data } = await this.supabase.service
        .from('organizations')
        .select('id, name, slug')
        .eq('id', id)
        .maybeSingle();
      if (!data) throw new NotFoundException(`Organization ${id} not found`);
      return data as { id: string; name: string; slug: string };
    }
    const { data, error } = await this.supabase.service
      .from('organizations')
      .update(patch)
      .eq('id', id)
      .select('id, name, slug')
      .single();
    if (error || !data) {
      throw new BadRequestException(error?.message ?? 'Failed to update organization');
    }
    await this.writeAuditLog(actorUserId, 'org.update', 'organization', id, patch);
    return data as { id: string; name: string; slug: string };
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

  // ── Reassign / assign ownership ──────────────────────────────────────────

  /**
   * Assigns an owner to an org. Handles three cases uniformly:
   *   - Org has no current owner → first-time assignment.
   *   - Org has a current owner, new owner is an existing member → promote.
   *   - Org has a current owner, new owner is a brand-new user → create
   *     account then promote.
   *
   * The DTO accepts `ownerUserId` (existing user), `ownerEmail` +
   * `ownerDisplayName` (new account), or `newOwnerUserId` (deprecated
   * alias for `ownerUserId`).
   */
  async reassignOwner(
    orgId: string,
    dto: ReassignOwnerDto,
    actorUserId: string,
  ): Promise<AssignOwnerResult> {
    // Accept deprecated alias for backwards compat with older clients.
    const resolved: { ownerUserId?: string; ownerEmail?: string; ownerDisplayName?: string } = {
      ownerUserId: dto.ownerUserId ?? dto.newOwnerUserId,
      ownerEmail: dto.ownerEmail,
      ownerDisplayName: dto.ownerDisplayName,
    };

    if (!resolved.ownerUserId && !resolved.ownerEmail) {
      throw new BadRequestException('Provide ownerUserId or ownerEmail');
    }
    if (resolved.ownerUserId && resolved.ownerEmail) {
      throw new BadRequestException('Provide at most one of ownerUserId or ownerEmail');
    }

    try {
      // Verify the org exists.
      const { data: org } = await this.supabase.service
        .from('organizations')
        .select('id')
        .eq('id', orgId)
        .maybeSingle();
      if (!org) {
        throw new NotFoundException(`Organization ${orgId} not found`);
      }

      const owner = await this.bootstrapOwnerAccount(resolved);

      // Find current owner(s) — may be zero.
      const { data: currentOwners } = await this.supabase.service
        .from('organization_members')
        .select('user_id')
        .eq('organization_id', orgId)
        .eq('role', 'owner');
      const hadPriorOwner = (currentOwners ?? []).length > 0;

      // Demote each (no-op if empty). Skip if the same user already holds
      // the owner role — nothing to do.
      for (const cur of currentOwners ?? []) {
        const curUserId = (cur as { user_id: string }).user_id;
        if (curUserId === owner.userId) continue;
        await this.supabase.service
          .from('organization_members')
          .update({ role: 'admin' })
          .eq('organization_id', orgId)
          .eq('user_id', curUserId);
      }

      // Insert or promote the new owner's membership row.
      const { data: existingMember } = await this.supabase.service
        .from('organization_members')
        .select('user_id, role')
        .eq('organization_id', orgId)
        .eq('user_id', owner.userId)
        .maybeSingle();

      if (existingMember) {
        if ((existingMember as { role: string }).role !== 'owner') {
          await this.supabase.service
            .from('organization_members')
            .update({ role: 'owner' })
            .eq('organization_id', orgId)
            .eq('user_id', owner.userId);
        }
      } else {
        const { error: insertErr } = await this.supabase.service
          .from('organization_members')
          .insert({
            organization_id: orgId,
            user_id: owner.userId,
            role: 'owner',
          });
        if (insertErr) {
          throw new Error(`Failed to insert owner membership: ${insertErr.message}`);
        }
      }

      const action: AssignOwnerResult['action'] = hadPriorOwner
        ? 'org.owner_reassigned'
        : 'org.owner_assigned';

      await this.writeAuditLog(actorUserId, action, 'organization', orgId, {
        new_owner_user_id: owner.userId,
        owner_created: owner.created,
      });

      // Send a magic link so the new owner can sign in. If the account
      // was just created, also send the welcome-password email.
      const { data: orgRow } = await this.supabase.service
        .from('organizations')
        .select('name, slug')
        .eq('id', orgId)
        .maybeSingle();
      const orgName = (orgRow as { name?: string } | null)?.name ?? 'your organization';
      const orgSlug = (orgRow as { slug?: string } | null)?.slug ?? '';
      const magicLinkSent = await this.trySendOwnerMagicLink(
        owner.email,
        owner.displayName,
        orgSlug,
      );
      if (owner.created && owner.temporaryPassword) {
        await this.trySendOwnerWelcomePassword(
          owner.email,
          owner.displayName,
          orgName,
          orgSlug,
          owner.temporaryPassword,
        );
      }

      this.logger.log(
        `Org ${orgId} ${hadPriorOwner ? 'reassigned' : 'assigned'} owner ${owner.userId} by ${actorUserId}`,
      );

      return {
        ownerUserId: owner.userId,
        ownerCreated: owner.created,
        magicLinkSent,
        action,
      };
    } catch (err) {
      if (err instanceof BadRequestException || err instanceof NotFoundException) throw err;
      this.logger.error(`Failed to assign owner for org ${orgId}: ${String(err)}`);
      throw new BadRequestException('Failed to assign ownership');
    }
  }

  /**
   * Resolves the owner identity from either an existing userId or an
   * email (creating an auth user when needed). Returns a normalized
   * {@link BootstrappedOwner} for the caller to persist as a member.
   *
   * Caller is expected to gate "neither input present" — this helper
   * throws if both are missing, but the error message assumes the caller
   * already validated DTO shape.
   */
  private async bootstrapOwnerAccount(input: {
    ownerUserId?: string;
    ownerEmail?: string;
    ownerDisplayName?: string;
  }): Promise<BootstrappedOwner> {
    if (input.ownerUserId) {
      const response = await this.supabase.getAuthAdminUser(input.ownerUserId);
      if (!response.ok || !response.data?.id) {
        throw new BadRequestException(`User ${input.ownerUserId} not found`);
      }
      const email = (response.data.email ?? '').toLowerCase();
      const metaName = response.data.user_metadata?.['display_name'];
      const displayName = typeof metaName === 'string' && metaName.trim() ? metaName.trim() : email;
      return { userId: response.data.id, email, displayName, created: false };
    }

    if (!input.ownerEmail) {
      throw new BadRequestException('Provide ownerUserId or ownerEmail');
    }

    const ownerEmail = input.ownerEmail.trim().toLowerCase();
    const ownerDisplayName = input.ownerDisplayName?.trim() || ownerEmail;

    const existing = await this.findAuthUserByEmail(ownerEmail);
    if (existing) {
      return {
        userId: existing.id,
        email: existing.email ?? ownerEmail,
        displayName: ownerDisplayName,
        created: false,
      };
    }

    const temporaryPassword = this.generateTemporaryPassword();
    const response = await this.supabase.createAuthAdminUser({
      email: ownerEmail,
      password: temporaryPassword,
      email_confirm: true,
      user_metadata: { display_name: ownerDisplayName },
    });

    if (!response.ok || !response.data) {
      // Race: someone else may have created the account between our
      // lookup and our create.
      if (this.isAlreadyExistsResponse(response.detail)) {
        const raceWinner = await this.findAuthUserByEmail(ownerEmail);
        if (raceWinner) {
          return {
            userId: raceWinner.id,
            email: raceWinner.email ?? ownerEmail,
            displayName: ownerDisplayName,
            created: false,
          };
        }
      }
      this.logger.error(
        `Failed to create organizer account for ${ownerEmail}: ${this.formatGoTrueDetail(response)}`,
      );
      throw new BadRequestException('Failed to create organizer account');
    }

    return {
      userId: response.data.id,
      email: response.data.email ?? ownerEmail,
      displayName: ownerDisplayName,
      created: true,
      temporaryPassword,
    };
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

  private async trySendOwnerWelcomePassword(
    email: string,
    displayName: string,
    orgName: string,
    orgSlug: string,
    temporaryPassword: string,
  ): Promise<void> {
    if (!this.mail) return;
    const domain = this.config?.get<string>('DOMAIN', 'myclash.localhost') ?? 'myclash.localhost';
    const loginUrl = `https://admin.${domain}/login`;
    const orgUrl = `https://admin.${domain}/org/${orgSlug}`;
    try {
      await this.mail.sendOwnerWelcomePassword({
        to: email,
        displayName,
        orgName,
        temporaryPassword,
        loginUrl,
        orgUrl,
      });
    } catch (err) {
      this.logger.warn(`Could not send owner welcome-password email to ${email}: ${String(err)}`);
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
