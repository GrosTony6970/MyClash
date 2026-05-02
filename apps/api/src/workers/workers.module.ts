/**
 * workers.module.ts
 *
 * Registers all BullMQ queues and workers.
 * Imported by AppModule.
 */

import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SupabaseModule } from '../modules/supabase/supabase.module';
import { HEMA_RATINGS_QUEUE, HemaRatingsSyncWorker } from './hema-ratings-sync.worker';
import {
  NOTIFICATION_QUEUE,
  NotificationSchedulerService,
  NotificationSchedulerWorker,
  WebPushSender,
} from './notification-scheduler.worker';

@Module({
  imports: [
    // Register the BullMQ queue with Redis connection from env
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get<string>('REDIS_HOST', 'localhost'),
          port: config.get<number>('REDIS_PORT', 6379),
          password: config.get<string>('REDIS_PASSWORD') ?? undefined,
        },
      }),
      inject: [ConfigService],
    }),
    BullModule.registerQueue({
      name: HEMA_RATINGS_QUEUE,
    }),
    BullModule.registerQueue({
      name: NOTIFICATION_QUEUE,
    }),
    SupabaseModule,
  ],
  providers: [
    HemaRatingsSyncWorker,
    NotificationSchedulerService,
    NotificationSchedulerWorker,
    WebPushSender,
  ],
  exports: [BullModule, NotificationSchedulerService],
})
export class WorkersModule {}
