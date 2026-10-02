import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { FollowNotificationSchedulerService } from '../../workers/follow-notification-scheduler.worker';
import { removeFollowersOfProfile } from '../follows/followers-removal';
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

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/**
 * The fighter merge and its revert (ruling 133). Each is ONE database function
 * (`merge_fighters`, `revert_fighter_merge`, migration 0212): the follows, event people,
 * instructors, both profiles, the account link and the merge record land together or not at
 * all. What moves, the refusals and the record's shape are the functions' own; the migration
 * header says them, and `scripts/db-merge-probe.mjs` proves them on Postgres.
 *
 * One thing follows a merge, outside the function: when the survivor ends "off", its followers
 * are removed (`removeFollowersWhenOff`, ruling 212).
 */
@Injectable()
export class FighterMergeService {
  private readonly logger = new Logger(FighterMergeService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly followAlerts: FollowNotificationSchedulerService,
  ) {}

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
    await this.removeFollowersWhenOff(dto.targetId);

    return {
      merged: true,
      sourceId: dto.sourceId,
      targetId: dto.targetId,
      moved: data as { persons: number; workshopInstructors: number },
    };
  }

  /**
   * A merge that leaves the survivor "off" removes its followers (ruling 212). The survivor keeps
   * the stricter choice, and the merged-away profile's roster rows and directory follows moved
   * onto it: without this, the people who followed a duplicate that said yes go on following,
   * and being told about, a person who said no. A revert does not bring them back.
   *
   * The choice is read AFTER the function, as saved: the function decides it.
   *
   * BEST EFFORT. The merge is committed, and the same call again is refused (the source is
   * merged away), so nothing here fails it; each failure is logged. What a failure leaves:
   * - an alert step that fails does not keep its follow: the follow goes all the same, and an
   *   alert whose follow is gone does not ring (`alert-still-wanted.ts`, ruling 213). The step
   *   removes, then sets again what the follower still wants: failing between the two, it can
   *   leave him without the alert of a bout or a session she shares with another person he
   *   follows, until that bout or session is timed again;
   * - a failed read of her roster rows or her followers, or a failed mute, leaves the followers
   *   in place and still told about her (nothing reads her choice when an alert is set or rings);
   *   the hub switches that were on go off after the roster read and before the followers are
   *   read, so past that point a hub follower is not told of her duties (ruling 217);
   * - a failed delete leaves them muted, so not told; a failed delete of the directory follows
   *   leaves her in each "Following" tab only, with the hub switch off (ruling 217);
   * - a merge that committed while its answer was lost never reaches this step.
   * No new follow lands in any of these. Two repairs: her own, "people may follow me" saved as
   * off again from her settings (on, then off: the page sends a change); and an admin's, a revert
   * of the merge and the same merge again, which runs this step again.
   *
   * Races, named, each a matter of milliseconds: her own save of the choice between the merge and
   * this read (the newer choice is the one acted on); a follow of the duplicate that passed its
   * check before the merge and lands after the delete (it stays, and rings); a revert between
   * the merge and this step (the duplicate's followers stay).
   */
  private async removeFollowersWhenOff(profileId: string): Promise<void> {
    try {
      const { data, error } = await this.supabase.service
        .from('global_persons')
        .select('allow_being_followed')
        .eq('id', profileId)
        .maybeSingle();
      if (error) throw new Error(`survivor choice read failed: ${error.message}`);
      if ((data as { allow_being_followed: boolean } | null)?.allow_being_followed !== false) {
        return;
      }
      await removeFollowersOfProfile(
        {
          supabase: this.supabase,
          alerts: {
            applyFollow: (person, follower) =>
              this.removeAlerts(`follower ${follower} about ${person}`, () =>
                this.followAlerts.applyFollow(person, follower),
              ),
            applyHubFollow: (profile, followers) =>
              this.removeAlerts(`the hub followers of ${profile}`, () =>
                this.followAlerts.applyHubFollow(profile, followers),
              ),
          },
        },
        profileId,
      );
    } catch (err) {
      this.logger.error(
        `Merge into ${profileId} is done, but the removal of its followers failed: ${messageOf(err)}`,
      );
    }
  }

  /** Waiting alerts about her, brought in line with the follows as saved; logged on failure. */
  private async removeAlerts(whose: string, step: () => Promise<void>): Promise<void> {
    try {
      await step();
    } catch (err) {
      this.logger.error(
        `Merge: the alerts of ${whose} were not brought in line: ${messageOf(err)}`,
      );
    }
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
