import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { insertAuditLog } from '../../common/audit-log';
import type { MergeFightersDto } from './dto/fighters.dto';

const REVERT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

type FighterRow = Record<string, unknown> & {
  id: string;
  display_name?: string | null;
  merged_into_id?: string | null;
  deleted_at?: string | null;
};

interface MergeAuditPayload {
  source: FighterRow;
  target: FighterRow;
  moved: {
    personIds: string[];
    /** @deprecated registrations now follow persons.global_person_id, no direct cascade. */
    registrationIds?: string[];
    workshopInstructorIds: string[];
  };
  reason: string | null;
}

function ids(rows: unknown): string[] {
  return ((rows as Array<{ id: string }> | null) ?? []).map((row) => row.id);
}

function fillTargetFields(source: FighterRow, target: FighterRow): Record<string, unknown> {
  const updates: Record<string, unknown> = {};
  for (const field of ['photo_url', 'hema_ratings_id', 'bio', 'country_code', 'gender_category']) {
    if (!target[field] && source[field]) updates[field] = source[field];
  }
  updates['updated_at'] = new Date().toISOString();
  return updates;
}

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

  async merge(dto: MergeFightersDto, actorUserId: string) {
    if (dto.sourceId === dto.targetId) {
      throw new BadRequestException('Source and target fighters must be different');
    }

    const source = await this.loadFighter(dto.sourceId, 'source');
    const target = await this.loadFighter(dto.targetId, 'target');

    if (target.merged_into_id || target.deleted_at) {
      throw new BadRequestException('Target fighter cannot be a merged/deleted profile');
    }

    const personIds = await this.selectReferenceIds('persons', 'global_person_id', dto.sourceId);
    const workshopInstructorIds = await this.selectReferenceIds(
      'workshop_instructors',
      'global_person_id',
      dto.sourceId,
    );

    await this.supabase.service
      .from('global_persons')
      .update(fillTargetFields(source, target))
      .eq('id', dto.targetId);

    // Registrations cascade via persons.global_person_id — no direct
    // fighter_id update needed. Updating persons here re-points every
    // registration that references those persons.id.
    await this.updateReferences('persons', 'global_person_id', personIds, dto.targetId);
    await this.updateReferences(
      'workshop_instructors',
      'global_person_id',
      workshopInstructorIds,
      dto.targetId,
    );

    const now = new Date().toISOString();
    await this.supabase.service
      .from('global_persons')
      .update({
        merged_into_id: dto.targetId,
        merged_at: now,
        merge_reverted_at: null,
        deleted_at: now,
        updated_at: now,
      })
      .eq('id', dto.sourceId);

    const payload: MergeAuditPayload = {
      source,
      target,
      moved: { personIds, workshopInstructorIds },
      reason: dto.reason?.trim() || null,
    };
    await this.writeAudit(actorUserId, 'fighter.merge', dto.sourceId, payload);

    return {
      merged: true,
      sourceId: dto.sourceId,
      targetId: dto.targetId,
      moved: {
        persons: personIds.length,
        workshopInstructors: workshopInstructorIds.length,
      },
    };
  }

  async revertMerge(auditLogId: string, actorUserId: string): Promise<void> {
    const { data, error } = await this.supabase.service
      .from('audit_log')
      .select('id, action, entity_id, created_at, payload_json')
      .eq('id', auditLogId)
      .maybeSingle();

    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException(`Merge audit log ${auditLogId} not found`);

    const audit = data as {
      action: string;
      entity_id: string;
      created_at: string;
      payload_json: MergeAuditPayload;
    };
    if (audit.action !== 'fighter.merge') {
      throw new BadRequestException('Audit log entry is not a fighter merge');
    }
    if (Date.now() - new Date(audit.created_at).getTime() > REVERT_WINDOW_MS) {
      throw new BadRequestException('Fighter merge can only be reverted within 30 days');
    }

    const payload = audit.payload_json;
    const sourceId = payload.source.id;
    // Reverting the persons cascade automatically reverts the
    // registrations that referenced those persons. Older audit logs
    // may carry a moved.registrationIds list; ignore it — the column
    // no longer exists post-0083.
    await this.updateReferences(
      'persons',
      'global_person_id',
      payload.moved.personIds ?? [],
      sourceId,
    );
    await this.updateReferences(
      'workshop_instructors',
      'global_person_id',
      payload.moved.workshopInstructorIds ?? [],
      sourceId,
    );

    const now = new Date().toISOString();
    await this.supabase.service
      .from('global_persons')
      .update({
        merged_into_id: null,
        merged_at: null,
        deleted_at: null,
        merge_reverted_at: now,
        updated_at: now,
      })
      .eq('id', sourceId);

    await this.writeAudit(actorUserId, 'fighter.merge_revert', sourceId, {
      reverted_audit_log_id: auditLogId,
      source_id: sourceId,
      target_id: payload.target.id,
    });
  }

  private async loadFighter(id: string, role: 'source' | 'target'): Promise<FighterRow> {
    const { data, error } = await this.supabase.service
      .from('global_persons')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) throw new BadRequestException(error.message);
    if (!data) throw new NotFoundException(`${role} fighter ${id} not found`);
    return data as FighterRow;
  }

  private async selectReferenceIds(
    table: string,
    column: string,
    fighterId: string,
  ): Promise<string[]> {
    const result = (await this.supabase.service.from(table).select('id').eq(column, fighterId)) as {
      data: unknown;
      error: { message?: string } | null;
    };
    if (result.error) throw new BadRequestException(result.error.message);
    return ids(result.data);
  }

  private async updateReferences(
    table: string,
    column: string,
    rowIds: string[],
    fighterId: string,
  ): Promise<void> {
    if (rowIds.length === 0) return;
    const result = (await this.supabase.service
      .from(table)
      .update({ [column]: fighterId })
      .in('id', rowIds)) as { error: { message?: string } | null };
    if (result.error) throw new BadRequestException(result.error.message);
  }

  /**
   * THROWS on failure, unlike most audit writers, which are best-effort. A merge
   * rewrites identity across a dozen tables and is only reversible through this
   * record — completing one with no trail is worse than refusing it.
   *
   * Payloads here embed whole global_persons snapshots, so masking matters:
   * insertAuditLog strips contact details and leaves names, which the revert
   * flow reads.
   */
  private async writeAudit(
    actorUserId: string,
    action: string,
    entityId: string,
    payload: unknown,
  ): Promise<void> {
    const { error } = await insertAuditLog(this.supabase.service, {
      actorUserId,
      action,
      entityType: 'fighter',
      entityId,
      payload,
    });
    if (error) throw new BadRequestException(error.message);
  }
}
