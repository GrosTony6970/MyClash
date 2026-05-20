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

  /**
   * Bulk-approve a batch of ruleset submissions. Runs sequentially so a
   * mid-batch failure surfaces the offending id without rolling back prior
   * successes. Reports `{ succeeded, failed, errors }` for the UI.
   */
  async bulkApprove(
    ids: readonly string[],
    actorUserId: string,
  ): Promise<{ succeeded: number; failed: number; errors: { id: string; message: string }[] }> {
    const errors: { id: string; message: string }[] = [];
    let succeeded = 0;
    for (const id of ids) {
      try {
        await this.approveRuleset(id, actorUserId);
        succeeded += 1;
      } catch (err) {
        errors.push({ id, message: err instanceof Error ? err.message : 'Approve failed' });
      }
    }
    await this.writeAuditLog(actorUserId, 'ruleset.bulk_approve', 'ruleset_submission', 'batch', {
      count: ids.length,
      succeeded,
      failed: errors.length,
    });
    return { succeeded, failed: errors.length, errors };
  }

  /**
   * Bulk-reject a batch of ruleset submissions with a single shared reason.
   */
  async bulkReject(
    ids: readonly string[],
    reason: string,
    actorUserId: string,
  ): Promise<{ succeeded: number; failed: number; errors: { id: string; message: string }[] }> {
    const trimmed = reason.trim();
    if (!trimmed) throw new BadRequestException('Rejection reason is required');

    const errors: { id: string; message: string }[] = [];
    let succeeded = 0;
    for (const id of ids) {
      try {
        await this.rejectRuleset(id, { reason: trimmed }, actorUserId);
        succeeded += 1;
      } catch (err) {
        errors.push({ id, message: err instanceof Error ? err.message : 'Reject failed' });
      }
    }
    await this.writeAuditLog(actorUserId, 'ruleset.bulk_reject', 'ruleset_submission', 'batch', {
      count: ids.length,
      succeeded,
      failed: errors.length,
      reason: trimmed,
    });
    return { succeeded, failed: errors.length, errors };
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
