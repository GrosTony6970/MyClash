import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

export interface ListUsersQuery {
  page?: number;
  perPage?: number;
}

@Injectable()
export class AdminUsersService {
  private readonly logger = new Logger(AdminUsersService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async listUsers(query: ListUsersQuery = {}) {
    const page = query.page ?? 1;
    const perPage = query.perPage ?? 50;
    const { data, error } = await this.supabase.service.auth.admin.listUsers({ page, perPage });
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async disableUser(userId: string, actorUserId: string): Promise<void> {
    await this.updateBan(userId, '876000h', actorUserId, 'user.disable');
  }

  async enableUser(userId: string, actorUserId: string): Promise<void> {
    await this.updateBan(userId, 'none', actorUserId, 'user.enable');
  }

  async promoteSuperAdmin(userId: string, actorUserId: string): Promise<void> {
    // Verify the target user exists
    const { data: user, error } = await this.supabase.service.auth.admin.getUserById(userId);
    if (error || !user.user) throw new BadRequestException('User not found');

    // Upsert platform_roles row
    const { error: dbError } = await this.supabase.service
      .from('platform_roles')
      .upsert({ user_id: userId, role: 'super_admin' }, { onConflict: 'user_id' });
    if (dbError) throw new BadRequestException(dbError.message);

    await this.writeAuditLog(actorUserId, 'user.promote_super_admin', 'user', userId, {
      target_email: user.user.email,
    });
  }

  async revokeSuperAdmin(userId: string, actorUserId: string): Promise<void> {
    if (userId === actorUserId) {
      throw new BadRequestException('You cannot revoke your own super admin role');
    }

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

  private async updateBan(
    userId: string,
    banDuration: string,
    actorUserId: string,
    action: string,
  ): Promise<void> {
    const { error } = await this.supabase.service.auth.admin.updateUserById(userId, {
      ban_duration: banDuration,
    });
    if (error) throw new BadRequestException(error.message);

    await this.writeAuditLog(actorUserId, action, 'user', userId, {
      ban_duration: banDuration,
    });
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
}
