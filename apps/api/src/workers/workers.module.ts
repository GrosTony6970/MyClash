/**
 * workers.module.ts
 *
 * Registers all BullMQ queues and workers.
 * Imported by AppModule.
 */

import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LeaguesModule } from '../modules/leagues/leagues.module';
import { NotificationEventsService } from '../modules/notifications/event-handlers/notification-events.service';
import { SupabaseModule } from '../modules/supabase/supabase.module';
import { EVENT_STATUS_TICK_QUEUE, EventStatusTickerWorker } from './event-status-ticker.worker';
import { FollowNotificationSchedulerService } from './follow-notification-scheduler.worker';
import { HEMA_RATINGS_QUEUE, HemaRatingsSyncWorker } from './hema-ratings-sync.worker';
import {
  NOTIFICATION_QUEUE,
  NotificationSchedulerService,
  NotificationSchedulerWorker,
  WebPushSender,
} from './notification-scheduler.worker';

@Module({
  imports: [
    // Register the BullMQ queue with Redis connection from env.
    // Supports both REDIS_URL (Docker Compose) and REDIS_HOST/REDIS_PORT (local dev).
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => {
        const redisUrl = config.get<string>('REDIS_URL');
        if (redisUrl) {
          // Docker Compose injects REDIS_URL=redis://redis:6379
          return { connection: { url: redisUrl } };
        }
        return {
          connection: {
            host: config.get<string>('REDIS_HOST', 'localhost'),
            port: config.get<number>('REDIS_PORT', 6379),
            password: config.get<string>('REDIS_PASSWORD') ?? undefined,
          },
        };
      },
      inject: [ConfigService],
    }),
    BullModule.registerQueue({
      name: HEMA_RATINGS_QUEUE,
    }),
    BullModule.registerQueue({
      name: NOTIFICATION_QUEUE,
    }),
    BullModule.registerQueue({
      name: EVENT_STATUS_TICK_QUEUE,
    }),
    SupabaseModule,
    LeaguesModule,
  ],
  providers: [
    HemaRatingsSyncWorker,
    EventStatusTickerWorker,
    FollowNotificationSchedulerService,
    NotificationEventsService,
    NotificationSchedulerService,
    NotificationSchedulerWorker,
    WebPushSender,
  ],
  exports: [
    BullModule,
    FollowNotificationSchedulerService,
    NotificationEventsService,
    NotificationSchedulerService,
  ],
})
export class WorkersModule {}
