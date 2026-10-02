import { Injectable, Logger } from '@nestjs/common';
import { inListChunks } from '../../common/postgrest-in-list';
import { FollowNotificationSchedulerService } from '../../workers/follow-notification-scheduler.worker';
import { NotificationSchedulerService } from '../../workers/notification-scheduler.worker';
import { SupabaseService } from '../supabase/supabase.service';
import { lockedDutiesOfBouts, type LockedDuty } from './duties-of-bouts';

/**
 * The one thing to call after writing `matches.scheduled_at` or
 * `matches.lice_id`.
 *
 * TWO FIELDS, not one. A queued "your fight starts in 10 minutes" is timed off
 * the slot the fight had when the job was created, and its sentence NAMES the
 * piste — "… fights in 10 min — Pool 3 vs Dupont on Piste 2". Both are frozen
 * into the job body at enqueue.
 *
 * Move the fight in the clock and the job does not move with it; it fires at the
 * old minute, for a fight that is now somewhere else. Unschedule the fight and
 * it fires for a fight that is nowhere at all.
 *
 * Move the fight between PISTES and nothing fires at the wrong moment: the alert
 * arrives on time and sends the competitor to a piste they have left. That is
 * the harder half to notice, and it is why the piste came second.
 *
 * Nine places in this API wrote a match's time and ONE told the queue. Three
 * more wrote its piste and none did. That is not twelve oversights, it is a
 * missing seam: nothing connected writing either field to the alerts built from
 * them, so every new write path started life broken. This is that seam, and
 * `match-alert-coverage.test.ts` reds when a new write appears without it.
 *
 * TWO FAMILIES FOR A BOUT, both always. The fighter's own alert and their followers' are
 * separate queues built by separate services, and a caller that remembers one
 * and forgets the other is the exact half-fixed shape
 * `MatchesService.scheduleMatch` had for months — nothing looked wrong, because
 * the half that worked was the half anybody testing by hand would check.
 *
 * BEST EFFORT, DELIBERATELY. Both calls swallow their own read errors. A
 * schedule write that succeeded must not be reported as failed because Redis
 * was briefly unreachable — the operator would retry a move that already
 * landed. A missed alert is worse than nothing and better than a board that
 * refuses to save.
 *
 * A THIRD FAMILY: THE REFEREES' DUTIES (operator rulings 220, 221). A duty
 * starts at the earliest placed bout it covers, so a bout that moves can move
 * the "your duty starts soon" of its referees and of their followers. Those
 * alerts used to be set at the lock and never again: a Pool moved to the
 * afternoon still rang its referees in the morning. `refreshDuties` hands the
 * LOCKED duties of the moved bouts to both duty schedulers, which read in
 * sets: a crew on a Swiss round or a bracket is one duty per bout and role,
 * and a day delayed can touch a thousand of them.
 */
@Injectable()
export class MatchAlertRefresherService {
  private readonly logger = new Logger(MatchAlertRefresherService.name);

  constructor(
    private readonly personal: NotificationSchedulerService,
    private readonly follows: FollowNotificationSchedulerService,
    private readonly supabase: SupabaseService,
  ) {}

  /**
   * Bring the alerts in line with what these bouts now say: the two bout families, then the
   * referees' duties.
   *
   * Pass EVERY id the write touched, including ones whose time was cleared:
   * clearing is a reschedule, and both services cancel on a null time. A
   * piste-only change goes through here too — the body is rebuilt whole, so
   * there is no per-field variant to remember.
   *
   * `IN_LIST_MAX` bouts at a time. Each bout family reads its bouts, and then their
   * fighters' registrations, by id in the URL. A day cleared from the board
   * names every bout of the day, and a read that outgrew the URL would fail —
   * silently, being best effort — and leave the alert of every cleared bout
   * queued. This bounds the bout read at `IN_LIST_MAX` ids and the registration
   * read at twice that (two a bout); it does not bound a family's own later
   * reads, such as the followers' preferences. The duties are handed in pieces of
   * the same size, for the same reason: their referees' holders are read by id.
   */
  async refresh(matchIds: readonly string[]): Promise<void> {
    const ids = Array.from(new Set(matchIds.filter(Boolean)));
    for (const chunk of inListChunks(ids)) {
      await this.personal.scheduleMatchStartingMany(chunk);
      await this.follows.scheduleMatchStartingMany(chunk);
    }
    await this.refreshDuties(ids);
  }

  /**
   * The duty family: the alerts of the locked duties these bouts start, each duty once.
   *
   * Nothing here fails the write that moved the bouts. A failed read of the duties is warned,
   * and their alerts stay as they were. A scheduler that throws (the queue down, or a job being
   * sent at that instant, which cannot be removed) is warned too: some alerts of that piece were
   * not set, the others were. An unlocked duty is not asked: it rings for nobody, and the next
   * lock sets its alerts.
   */
  private async refreshDuties(matchIds: readonly string[]): Promise<void> {
    const duties = await this.dutiesOf(matchIds);
    const now = new Date();
    for (const piece of inListChunks(duties)) {
      await Promise.all([
        this.bestEffort("the referees' own", () =>
          this.personal.scheduleRefereeDutiesStarting(piece, now),
        ),
        this.bestEffort("their followers'", () =>
          this.follows.scheduleRefereeDutiesStarting(piece, now),
        ),
      ]);
    }
  }

  /** The locked duties of these bouts, each once; none (warned) when they cannot be read. */
  private async dutiesOf(matchIds: readonly string[]): Promise<LockedDuty[]> {
    const duties = new Map<string, LockedDuty>();
    try {
      for (const chunk of inListChunks(matchIds)) {
        for (const duty of await lockedDutiesOfBouts(this.supabase.service, chunk)) {
          duties.set(duty.id, duty);
        }
      }
    } catch (err) {
      this.warn(
        'The referee duties of the moved bouts are unreadable; their alerts stay as they were',
        err,
      );
      return [];
    }
    return [...duties.values()];
  }

  private async bestEffort(whose: string, set: () => Promise<void>): Promise<void> {
    try {
      await set();
    } catch (err) {
      this.warn(`The duty alerts of the moved bouts were not all set (${whose})`, err);
    }
  }

  private warn(what: string, err: unknown): void {
    this.logger.warn(`${what}: ${err instanceof Error ? err.message : String(err)}`);
  }
}
