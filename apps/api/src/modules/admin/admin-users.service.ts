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
