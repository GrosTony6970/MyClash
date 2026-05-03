import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import type { ListRulesetsQueryDto, RejectRulesetDto } from './dto/admin-rulesets.dto';

@Injectable()
export class AdminRulesetsService {
  private readonly logger = new Logger(AdminRulesetsService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async listRulesets(query: ListRulesetsQueryDto = {}) {
    let q = this.supabase.service.from('ruleset_submissions').select('*');
    if (query.status) q = q.eq('status', query.status) as typeof q;
    const { data, error } = await q.order('created_at', { ascending: false });
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  async approveRuleset(id: string, actorUserId: string): Promise<void> {
    const now = new Date().toISOString();
    const { error } = await this.supabase.service
      .from('ruleset_submissions')
      .update({
        status: 'approved',
        reviewed_by_user_id: actorUserId,
        reviewed_at: now,
        rejection_reason: null,
        updated_at: now,
      })
      .eq('id', id);
    if (error) throw new BadRequestException(error.message);

    await this.writeAuditLog(actorUserId, 'ruleset.approve', 'ruleset_submission', id, {});
  }

  async rejectRuleset(id: string, dto: RejectRulesetDto, actorUserId: string): Promise<void> {
    const reason = dto.reason.trim();
    if (!reason) throw new BadRequestException('Rejection reason is required');

    const now = new Date().toISOString();
    const { error } = await this.supabase.service
      .from('ruleset_submissions')
      .update({
        status: 'rejected',
        reviewed_by_user_id: actorUserId,
        reviewed_at: now,
        rejection_reason: reason,
        updated_at: now,
      })
      .eq('id', id);
    if (error) throw new BadRequestException(error.message);

    await this.writeAuditLog(actorUserId, 'ruleset.reject', 'ruleset_submission', id, { reason });
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
