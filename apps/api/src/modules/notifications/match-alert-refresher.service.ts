import { Injectable } from '@nestjs/common';
import { FollowNotificationSchedulerService } from '../../workers/follow-notification-scheduler.worker';
import { NotificationSchedulerService } from '../../workers/notification-scheduler.worker';

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
 * TWO FAMILIES, both always. The fighter's own alert and their followers' are
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
 */
@Injectable()
export class MatchAlertRefresherService {
  constructor(
    private readonly personal: NotificationSchedulerService,
    private readonly follows: FollowNotificationSchedulerService,
  ) {}

  /**
   * Bring both alert families in line with what these bouts now say.
   *
   * Pass EVERY id the write touched, including ones whose time was cleared:
   * clearing is a reschedule, and both services cancel on a null time. A
   * piste-only change goes through here too — the body is rebuilt whole, so
   * there is no per-field variant to remember.
   */
  async refresh(matchIds: readonly string[]): Promise<void> {
    const ids = Array.from(new Set(matchIds.filter(Boolean)));
    if (ids.length === 0) return;
    await this.personal.scheduleMatchStartingMany(ids);
    await this.follows.scheduleMatchStartingMany(ids);
  }
}
