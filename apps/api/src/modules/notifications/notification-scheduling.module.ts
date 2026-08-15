import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import {
  NOTIFICATION_QUEUE,
  NotificationSchedulerService,
  NotificationSchedulerWorker,
  WebPushSender,
} from '../../workers/notification-scheduler.worker';
import { FollowNotificationSchedulerService } from '../../workers/follow-notification-scheduler.worker';
import { NotificationEventsService } from './event-handlers/notification-events.service';
import { MatchAlertRefresherService } from './match-alert-refresher.service';

/**
 * Leaf module owning the notification-scheduling subsystem: the enqueue
 * services, their push/email delivery worker, and the NOTIFICATION_QUEUE.
 *
 * Extracted out of WorkersModule to break a module import CYCLE. RefereesModule
 * needs these services but importing all of WorkersModule closed
 *
 *   WorkersModule → LeaguesModule → TournamentPlacementModule → PhasesModule
 *     → RefereesModule → WorkersModule
 *
 * (league scoring started reading the bracket via Phases, and Referees imports
 * WorkersModule for notifications). Depending on this leaf instead removes the
 * back-edge — no forwardRef needed. See module-graph.test.ts.
 *
 * All runtime dependencies are global (SupabaseModule, MailModule, ConfigModule)
 * or self-registered here (the queue), so this module has no import edges that
 * could re-enter the graph. `registerQueue` in a module separate from the
 * `forRootAsync` in WorkersModule is fine — BullMQ deduplicates by queue name at
 * the Redis layer (same pattern as HemaRatingsModule).
 */
@Module({
  imports: [BullModule.registerQueue({ name: NOTIFICATION_QUEUE })],
  providers: [
    NotificationSchedulerService,
    FollowNotificationSchedulerService,
    NotificationEventsService,
    MatchAlertRefresherService,
    WebPushSender,
    NotificationSchedulerWorker,
  ],
  exports: [
    NotificationSchedulerService,
    FollowNotificationSchedulerService,
    NotificationEventsService,
    // Every service that writes `matches.scheduled_at` depends on this one.
    // It is exported from the LEAF for that reason: Programme, Phases, Matches
    // and the AI assistant all need it, and any of them importing a heavier
    // module to reach it would re-open the cycle this leaf was cut to break.
    MatchAlertRefresherService,
  ],
})
export class NotificationSchedulingModule {}
