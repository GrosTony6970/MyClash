import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import type { UpsertFeatureFlagDto } from './dto/admin-feature-flags.dto';

@Injectable()
export class AdminFeatureFlagsService {
  private readonly logger = new Logger(AdminFeatureFlagsService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async listFlags() {
    const { data, error } = await this.supabase.service
      .from('feature_flags')
      .select('*')
      .order('key', { ascending: true });
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async upsertFlag(key: string, dto: UpsertFeatureFlagDto, actorUserId: string): Promise<void> {
    const trimmedKey = key.trim();
    if (!trimmedKey) throw new BadRequestException('Feature flag key is required');

    const now = new Date().toISOString();
    const { error } = await this.supabase.service.from('feature_flags').upsert({
      key: trimmedKey,
      description: dto.description ?? null,
      enabled: dto.enabled,
      payload_json: dto.payload ?? null,
      updated_by_user_id: actorUserId,
      updated_at: now,
    });
    if (error) throw new BadRequestException(error.message);

    await this.writeAuditLog(actorUserId, 'feature_flag.upsert', 'feature_flag', trimmedKey, {
      enabled: dto.enabled,
    });
  }

  async deleteFlag(key: string, actorUserId: string): Promise<void> {
    const trimmedKey = key.trim();
    if (!trimmedKey) throw new BadRequestException('Feature flag key is required');

    const { error } = await this.supabase.service
      .from('feature_flags')
      .delete()
      .eq('key', trimmedKey);
    if (error) throw new BadRequestException(error.message);

    await this.writeAuditLog(actorUserId, 'feature_flag.delete', 'feature_flag', trimmedKey, {});
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
