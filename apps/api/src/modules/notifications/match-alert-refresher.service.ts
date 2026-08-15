import { Injectable } from '@nestjs/common';
import { FollowNotificationSchedulerService } from '../../workers/follow-notification-scheduler.worker';
import { NotificationSchedulerService } from '../../workers/notification-scheduler.worker';

/**
 * The one thing to call after writing `matches.scheduled_at`.
 *
 * A queued "your fight starts in 10 minutes" is timed off the slot the fight
 * had when the job was created. Move the fight and the job does not move with
 * it; it fires at the old minute, for a fight that is now somewhere else.
 * Unschedule the fight and it fires for a fight that is nowhere at all. On the
 * day, that alert is the thing a competitor is actually relying on.
 *
 * Nine places in this API wrote a match's time. ONE of them told the queue.
 * That is not eight oversights, it is a missing seam: nothing connected writing
 * a time to the alerts built from it, so every new write path started life
 * broken. This is that seam, and `match-alert-coverage.test.ts` reds when a new
 * write appears without it.
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
   * clearing is a reschedule, and both services cancel on a null time.
   */
  async refresh(matchIds: readonly string[]): Promise<void> {
    const ids = Array.from(new Set(matchIds.filter(Boolean)));
    if (ids.length === 0) return;
    await this.personal.scheduleMatchStartingMany(ids);
    await this.follows.scheduleMatchStartingMany(ids);
  }
}
