import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { insertAuditLog } from '../../common/audit-log';
import type { MergeFightersDto } from './dto/fighters.dto';

const REVERT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
/** Rows asked for per read of a profile pair's follows. A lower row cap only shortens a page. */
const FOLLOWS_PAGE = 1000;
/** Followers per follows move: the `in` filter travels in the request URL. */
const MOVE_CHUNK = 200;

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
    /**
     * The accounts whose directory follow moved to the survivor (ruling 116). Account ids, not
     * follow ids: the audit screen names an account. Absent from audit logs before ruling 116.
     */
    directoryFollowerUserIds?: string[];
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

    // Ruling 125: merged a second time, its references (already moved) would move nowhere and the
    // new record would overwrite where a revert must send them back.
    if (source.merged_into_id) {
      throw new BadRequestException('Source fighter is already merged into another profile');
    }

    if (target.merged_into_id || target.deleted_at) {
      throw new BadRequestException('Target fighter cannot be a merged/deleted profile');
    }

    const moved = await this.moveReferences(dto.sourceId, dto.targetId);

    await this.writeFighter(dto.targetId, fillTargetFields(source, target));

    const now = new Date().toISOString();
    await this.writeFighter(dto.sourceId, {
      merged_into_id: dto.targetId,
      merged_at: now,
      merge_reverted_at: null,
      deleted_at: now,
      updated_at: now,
    });

    const payload: MergeAuditPayload = {
      source,
      target,
      moved,
      reason: dto.reason?.trim() || null,
    };
    await this.writeAudit(actorUserId, 'fighter.merge', dto.sourceId, payload);

    return {
      merged: true,
      sourceId: dto.sourceId,
      targetId: dto.targetId,
      moved: {
        persons: moved.personIds.length,
        workshopInstructors: moved.workshopInstructorIds.length,
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
    await this.assertCurrentMerge(auditLogId, audit.created_at, sourceId, payload.target.id);
    await this.restoreReferences(payload.moved, sourceId, payload.target.id);

    const now = new Date().toISOString();
    await this.writeFighter(sourceId, {
      merged_into_id: null,
      merged_at: null,
      deleted_at: null,
      merge_reverted_at: now,
      updated_at: now,
    });

    await this.writeAudit(actorUserId, 'fighter.merge_revert', sourceId, {
      reverted_audit_log_id: auditLogId,
      source_id: sourceId,
      target_id: payload.target.id,
    });
  }

  /**
   * A profile write of a merge or revert. A failure is a 5xx: `merged_into_id` is what a revert
   * trusts to know the merge still holds, so a flag write that failed quietly would leave a merge
   * nobody can revert (ruling 125).
   */
  private async writeFighter(id: string, updates: Record<string, unknown>): Promise<void> {
    const { error } = await this.supabase.service
      .from('global_persons')
      .update(updates)
      .eq('id', id);
    if (error) throw new Error(`fighter write failed: ${error.message}`);
  }

  /**
   * Only the source's current merge can be reverted (ruling 125). A reverted one no longer holds:
   * its references are back, and a second revert would move follows and people made since. A merge
   * of the same profile after it replaced it: its record, not this one, says what moved. And while
   * the survivor is itself merged away, its follows and people sit on a third profile: a revert
   * would send the people back and leave the follows there, so the later merge goes first.
   */
  private async assertCurrentMerge(
    auditLogId: string,
    mergedAt: string,
    sourceId: string,
    targetId: string,
  ): Promise<void> {
    const source = await this.loadFighter(sourceId, 'source');
    if (source.merged_into_id !== targetId) {
      throw new BadRequestException('This fighter merge was already reverted');
    }
    const target = await this.loadFighter(targetId, 'target');
    if (target.merged_into_id) {
      throw new BadRequestException(
        'The surviving fighter was merged into another profile since: revert that merge first',
      );
    }
    const { data, error } = await this.supabase.service
      .from('audit_log')
      .select('id')
      .eq('action', 'fighter.merge')
      .eq('entity_type', 'fighter')
      .eq('entity_id', sourceId)
      .gt('created_at', mergedAt)
      .limit(1);
    if (error) throw new Error(`merge history read failed: ${error.message}`);
    if ((data ?? []).length > 0) {
      throw new BadRequestException(
        'A later merge of this fighter replaced this one: revert the later merge first',
      );
    }
  }

  /**
   * Re-points the event people, workshop instructors and directory follows of the merged-away
   * profile at the surviving one (not every row naming it: group members, league results and
   * claim links stay), and returns what moved: the audit record keeps it, and the revert moves
   * exactly that back. Every read comes before the first write.
   */
  private async moveReferences(
    sourceId: string,
    targetId: string,
  ): Promise<MergeAuditPayload['moved']> {
    const personIds = await this.selectReferenceIds('persons', 'global_person_id', sourceId);
    const workshopInstructorIds = await this.selectReferenceIds(
      'workshop_instructors',
      'global_person_id',
      sourceId,
    );
    const directoryFollowerUserIds = await this.followersToMove(sourceId, targetId);

    // The follows go FIRST. A follow of the survivor tapped since the read breaks the
    // one-follow-per-pair key here; as the first write, that failure leaves no people or flags
    // moved, and the retry reads afresh. The move runs a chunk at a time, though: a failure after
    // the first chunk leaves those follows on the survivor, and a retry's record no longer lists
    // them (named in the handover; one database statement would close it).
    await this.moveFollows(directoryFollowerUserIds, sourceId, targetId);
    // Registrations cascade via persons.global_person_id — no direct
    // fighter_id update needed. Updating persons here re-points every
    // registration that references those persons.id.
    await this.updateReferences('persons', 'global_person_id', personIds, targetId);
    await this.updateReferences(
      'workshop_instructors',
      'global_person_id',
      workshopInstructorIds,
      targetId,
    );
    return { personIds, workshopInstructorIds, directoryFollowerUserIds };
  }

  /**
   * Reverting the persons cascade automatically reverts the registrations that
   * referenced those persons. Older audit logs may carry a moved.registrationIds
   * list; ignore it — the column no longer exists post-0083. Audit logs older
   * than ruling 116 carry no directoryFollowerUserIds: nothing of theirs moved.
   */
  private async restoreReferences(
    moved: MergeAuditPayload['moved'],
    sourceId: string,
    targetId: string,
  ): Promise<void> {
    await this.moveFollows(moved.directoryFollowerUserIds ?? [], targetId, sourceId);
    await this.updateReferences('persons', 'global_person_id', moved.personIds ?? [], sourceId);
    await this.updateReferences(
      'workshop_instructors',
      'global_person_id',
      moved.workshopInstructorIds ?? [],
      sourceId,
    );
  }

  /**
   * The accounts following the merged-away profile but not the survivor (ruling 116). One who
   * follows both keeps that follow on the merged profile — hidden with it, and whole again if the
   * merge is reverted — because moving it would break the one-follow-per-pair key.
   */
  private async followersToMove(sourceId: string, targetId: string): Promise<string[]> {
    const rows: Array<{ id: string; follower_user_id: string; followed_global_person_id: string }> =
      [];
    // Paged by id (ruling 125): one read would stop at the row cap and leave the rest behind.
    for (let after: string | null = null; ;) {
      let page = this.supabase.service
        .from('directory_follows')
        .select('id, follower_user_id, followed_global_person_id')
        .in('followed_global_person_id', [sourceId, targetId]);
      if (after) page = page.gt('id', after);
      const { data, error } = await page.order('id', { ascending: true }).limit(FOLLOWS_PAGE);
      // A 5xx: read as "no follows", the merge would leave every follow on the hidden profile.
      if (error) throw new Error(`directory follows read failed: ${error.message}`);
      const found = (data ?? []) as typeof rows;
      rows.push(...found);
      // Stop on an empty page, not a short one: a row cap under the page size shortens every page.
      if (found.length === 0) break;
      after = found[found.length - 1]!.id;
    }
    const followerIds = (profileId: string) =>
      rows
        .filter((row) => row.followed_global_person_id === profileId)
        .map((row) => row.follower_user_id);
    const survivorFollowers = new Set(followerIds(targetId));
    return followerIds(sourceId).filter((userId) => !survivorFollowers.has(userId));
  }

  /**
   * These accounts' follows of `fromId` now follow `toId`, a chunk at a time (the ids travel in
   * the URL). A failed write is a 5xx.
   */
  private async moveFollows(followerUserIds: string[], fromId: string, toId: string) {
    for (let at = 0; at < followerUserIds.length; at += MOVE_CHUNK) {
      const { error } = await this.supabase.service
        .from('directory_follows')
        .update({ followed_global_person_id: toId })
        .eq('followed_global_person_id', fromId)
        .in('follower_user_id', followerUserIds.slice(at, at + MOVE_CHUNK));
      if (error) throw new Error(`directory follows move failed: ${error.message}`);
    }
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
