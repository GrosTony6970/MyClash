import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import type {
  ListOrgsQueryDto,
  PromoteSuperAdminDto,
  ReassignOwnerDto,
} from './dto/admin-organizations.dto';

/** Shape returned for each org in the list view. */
export interface OrgListItem {
  id: string;
  name: string;
  slug: string;
  status: 'active' | 'suspended';
  owner_email: string | null;
  member_count: number;
  event_count: number;
  created_at: string;
  last_activity: string | null;
}

/** Shape returned for the org detail view. */
export interface OrgDetail extends OrgListItem {
  members: Array<{
    user_id: string;
    email: string;
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

@Injectable()
export class AdminOrganizationsService {
  private readonly logger = new Logger(AdminOrganizationsService.name);

  constructor(private readonly supabase: SupabaseService) {}

  // ── List ────────────────────────────────────────────────────────────────

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

      // Flatten into OrgListItem shape
      return ((data ?? []) as Array<Record<string, unknown>>).map((org) => {
        const members =
          (org['organization_members'] as Array<{ user_id: string; role: string }>) ?? [];
        const ownerMember = members.find((m) => m.role === 'owner');
        return {
          id: org['id'] as string,
          name: org['name'] as string,
          slug: org['slug'] as string,
          status: org['status'] as 'active' | 'suspended',
          owner_email: ownerMember ? `user:${ownerMember.user_id}` : null,
          member_count: members.length,
          event_count: ((org['events'] as unknown[]) ?? []).length,
          created_at: org['created_at'] as string,
          last_activity: null,
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
        owner_email: null,
        member_count: members.length,
        event_count: ((o['events'] as unknown[]) ?? []).length,
        created_at: o['created_at'] as string,
        last_activity: null,
        members: members.map((m) => ({
          user_id: m.user_id,
          email: `user:${m.user_id}`,
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
    await this.updateStatus(id, 'suspended', actorUserId, 'org.suspend');
  }

  // ── Reactivate ───────────────────────────────────────────────────────────

  async reactivateOrganization(id: string, actorUserId: string): Promise<void> {
    await this.updateStatus(id, 'active', actorUserId, 'org.reactivate');
  }

  // ── Delete (hard) ────────────────────────────────────────────────────────

  async deleteOrganization(id: string, actorUserId: string): Promise<void> {
    try {
      // Ensure a <deleted> placeholder org exists for data preservation
      await this.ensureDeletedPlaceholder();

      // Log before deletion
      await this.writeAuditLog(actorUserId, 'org.delete', 'organization', id, { hard: true });

      const { error } = await this.supabase.service.from('organizations').delete().eq('id', id);

      if (error) throw error;
      this.logger.log(`Organization ${id} hard-deleted by ${actorUserId}`);
    } catch (err) {
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
}
