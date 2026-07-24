/**
 * workers.module.ts
 *
 * Registers all BullMQ queues and workers.
 * Imported by AppModule.
 */

import { forwardRef, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AdminModule } from '../modules/admin/admin.module';
import { LeaguesModule } from '../modules/leagues/leagues.module';
import { NotificationSchedulingModule } from '../modules/notifications/notification-scheduling.module';
import { SupabaseModule } from '../modules/supabase/supabase.module';
import {
  DATA_QUALITY_DETERMINISTIC_QUEUE,
  DataQualityDeterministicWorker,
} from './data-quality-deterministic.worker';
import { EVENT_ARCHIVE_QUEUE, EventArchiveWorker } from './event-archive.worker';
import { EVENT_STATUS_TICK_QUEUE, EventStatusTickerWorker } from './event-status-ticker.worker';
import { HEMA_RATINGS_QUEUE, HemaRatingsSyncWorker } from './hema-ratings-sync.worker';
import { TLS_CERT_MONITOR_QUEUE, TlsCertMonitorWorker } from './tls-cert-monitor.worker';

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
      // Daily sync may fail transiently (hemaratings.com DNS / timeout /
      // 5xx). Retry up to 3× with exponential back-off before surfacing
      // the failure to the BullMQ failed-jobs list.
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 60_000 },
      },
    }),
    BullModule.registerQueue({
      name: EVENT_STATUS_TICK_QUEUE,
    }),
    BullModule.registerQueue({
      name: EVENT_ARCHIVE_QUEUE,
    }),
    BullModule.registerQueue({
      name: DATA_QUALITY_DETERMINISTIC_QUEUE,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 60_000 },
      },
    }),
    BullModule.registerQueue({
      name: TLS_CERT_MONITOR_QUEUE,
    }),
    SupabaseModule,
    // The notification-scheduling subsystem (enqueue services + NOTIFICATION_QUEUE
    // + delivery worker) lives in this leaf module. Re-exported below so the
    // feature modules that import WorkersModule for notifications keep resolving
    // them. Extracting it is what lets RefereesModule depend on the leaf instead
    // of WorkersModule, breaking the former
    //   WorkersModule → LeaguesModule → TournamentPlacementModule → PhasesModule
    //     → RefereesModule → WorkersModule
    // cycle. EventStatusTickerWorker still constructor-injects LeaguesService, so
    // the Workers → Leagues edge remains — but it is now a dead-end (nothing under
    // Leagues loops back to Workers), so a plain import is correct; see
    // module-graph.test.ts.
    NotificationSchedulingModule,
    LeaguesModule,
    // forwardRef breaks the WorkersModule → AdminModule → MatchesModule
    // → WorkersModule cycle. AdminModule's services (AIDataQualityService,
    // AdminFeatureFlagsService) are constructor-injected into workers, but
    // the lookup happens after the module graph is resolved — so deferring
    // the AdminModule reference here is safe and matches Nest's documented
    // pattern for service-level cycles.
    forwardRef(() => AdminModule),
  ],
  providers: [
    HemaRatingsSyncWorker,
    EventStatusTickerWorker,
    EventArchiveWorker,
    DataQualityDeterministicWorker,
    TlsCertMonitorWorker,
  ],
  // Re-export the leaf so consumers importing WorkersModule still resolve the
  // notification services. BullModule stays exported for the queues Workers
  // still registers (hema-ratings, event-status-tick, event-archive,
  // data-quality, tls-cert-monitor).
  exports: [BullModule, NotificationSchedulingModule],
})
export class WorkersModule {}
