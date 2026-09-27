import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { maskAuditPayload } from '../../common/audit-log';
import type { MergeFightersDto } from './dto/fighters.dto';

/**
 * A database function's answer: its refusal (P0001) is a 400 and its not-found (P0002) a 404,
 * in the function's own words. Anything else means the call did not happen for a reason nobody
 * foresaw: a 5xx, never a guess (the function rolled everything back).
 */
function failure(error: { code?: string; message: string }, what: string): Error {
  if (error.code === 'P0001') return new BadRequestException(error.message);
  if (error.code === 'P0002') return new NotFoundException(error.message);
  return new Error(`${what} failed: ${error.message}`);
}

/**
 * The fighter merge and its revert (ruling 133). Each is ONE database function
 * (`merge_fighters`, `revert_fighter_merge`, migration 0212): the follows, event people,
 * instructors, both profiles, the account link and the merge record land together or not at
 * all. What moves, the refusals and the record's shape are the functions' own; the migration
 * header says them, and `scripts/db-merge-probe.mjs` proves them on Postgres.
 */
@Injectable()
export class FighterMergeService {
  constructor(private readonly supabase: SupabaseService) {}

  async listMergeAudits() {
    const { data, error } = await this.supabase.service
      .from('audit_log')
      .select('id, actor_user_id, action, entity_id, payload_json, created_at')
      .eq('entity_type', 'fighter')
      .eq('action', 'fighter.merge')
      .order('created_at', { ascending: false })
      .limit(25);
    if (error) throw new BadRequestException(error.message);
    return data ?? [];
  }

  /**
   * The two profiles are read here only for the merge record: masked by the one masker every
   * audit row goes through (`maskAuditPayload`), so no email or date of birth reaches the table
   * raw. The function decides everything on its own locked rows.
   */
  async merge(dto: MergeFightersDto, actorUserId: string) {
    const source = await this.loadFighter(dto.sourceId, 'source');
    const target = await this.loadFighter(dto.targetId, 'target');

    const { data, error } = await this.supabase.service.rpc('merge_fighters', {
      p_source_id: dto.sourceId,
      p_target_id: dto.targetId,
      p_actor_user_id: actorUserId,
      p_reason: dto.reason?.trim() || null,
      p_source_snapshot: maskAuditPayload(source),
      p_target_snapshot: maskAuditPayload(target),
    });
    if (error) throw failure(error, 'fighter merge');

    return {
      merged: true,
      sourceId: dto.sourceId,
      targetId: dto.targetId,
      moved: data as { persons: number; workshopInstructors: number },
    };
  }

  async revertMerge(auditLogId: string, actorUserId: string): Promise<void> {
    const { error } = await this.supabase.service.rpc('revert_fighter_merge', {
      p_audit_log_id: auditLogId,
      p_actor_user_id: actorUserId,
    });
    if (error) throw failure(error, 'fighter merge revert');
  }

  private async loadFighter(
    id: string,
    role: 'source' | 'target',
  ): Promise<Record<string, unknown>> {
    const { data, error } = await this.supabase.service
      .from('global_persons')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) throw new Error(`fighter read failed: ${error.message}`);
    if (!data) throw new NotFoundException(`${role} fighter ${id} not found`);
    return data as Record<string, unknown>;
  }
}
