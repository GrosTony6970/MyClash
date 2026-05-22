import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AdminModule } from './modules/admin/admin.module';
import { AuthModule } from './modules/auth/auth.module';
import { ClubsModule } from './modules/clubs/clubs.module';
import { EventsModule } from './modules/events/events.module';
import { FightersModule } from './modules/fighters/fighters.module';
import { FollowsModule } from './modules/follows/follows.module';
import { HealthModule } from './modules/health/health.module';
import { HemaRatingsModule } from './modules/hema-ratings/hema-ratings.module';
import { WorkshopsModule } from './modules/workshops/workshops.module';
import { ScheduleModule } from './modules/schedule/schedule.module';
import { RefereesModule } from './modules/referees/referees.module';
import { DeletionRequestsModule } from './modules/deletion-requests/deletion-requests.module';
import { ReviewQueueModule } from './modules/admin/review-queue.module';
import { StatsModule } from './modules/stats/stats.module';
import { StaffModule } from './modules/staff/staff.module';
import { ExportsModule } from './modules/exports/exports.module';
import { WorkersModule } from './workers/workers.module';
import { LicesModule } from './modules/lices/lices.module';
import { LeaguesModule } from './modules/leagues/leagues.module';
import { MailModule } from './modules/mail/mail.module';
import { MatchesModule } from './modules/matches/matches.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { PersonsModule } from './modules/persons/persons.module';
import { CompensationModule } from './modules/compensation/compensation.module';
import { PenaltiesModule } from './modules/penalties/penalties.module';
import { PhasesModule } from './modules/phases/phases.module';
import { AIProvidersModule } from './modules/ai-providers/ai-providers.module';
import { AIUsageModule } from './modules/ai-usage/ai-usage.module';
import { ProgrammeModule } from './modules/programme/programme.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { RegistrationsModule } from './modules/registrations/registrations.module';
import { RulesetsModule } from './modules/rulesets/rulesets.module';
import { SupabaseModule } from './modules/supabase/supabase.module';
import { OrganizerAIAssistantModule } from './modules/organizer-ai-assistant/organizer-ai-assistant.module';
import { TournamentQueryModule } from './modules/tournament-query/tournament-query.module';
import { PoolStandingsModule } from './modules/pool-standings/pool-standings.module';
import { RequestLoggingMiddleware } from './common/observability/request-logging.middleware';
import { LockdownInterceptor } from './common/interceptors/lockdown.interceptor';
import { EventReadOnlyGuard } from './common/event-readonly/event-readonly.guard';

@Module({
  imports: [
    // ── Config ──────────────────────────────────────────────────────────
    ConfigModule.forRoot({
      isGlobal: true,
      // In production, env vars are injected by Docker Compose.
      // In dev, they come from .env at the repo root.
      envFilePath: ['../../.env', '.env'],
    }),

    // ── Rate limiting ────────────────────────────────────────────────────
    // Global defaults: 60 requests per minute per IP.
    // Heavy read-only admin/catalog routes and sensitive auth actions override this per route.
    ThrottlerModule.forRoot([
      {
        name: 'global',
        ttl: 60_000, // 1 minute window
        limit: 60,
      },
    ]),

    // ── Infrastructure ───────────────────────────────────────────────────
    SupabaseModule,
    MailModule,

    // ── Feature modules ──────────────────────────────────────────────────
    HealthModule,
    HemaRatingsModule,
    AuthModule,
    AdminModule,
    PersonsModule,
    ClubsModule,
    CompensationModule,
    FightersModule,
    EventsModule,
    LicesModule,
    LeaguesModule,
    PenaltiesModule,
    RegistrationsModule,
    MatchesModule,
    NotificationsModule,
    PhasesModule,
    ProgrammeModule,
    AIProvidersModule,
    AIUsageModule,
    OrganizerAIAssistantModule,
    TournamentQueryModule,
    FollowsModule,
    WorkshopsModule,
    ScheduleModule,
    RefereesModule,
    DeletionRequestsModule,
    ReviewQueueModule,
    StaffModule,
    StatsModule,
    ExportsModule,
    WorkersModule,
    RealtimeModule,
    RulesetsModule,
    PoolStandingsModule,
  ],
  providers: [
    // Apply ThrottlerGuard globally — individual controllers can override
    // with @SkipThrottle() or @Throttle({ global: { limit: 600, ttl: 60000 } })
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    // Block all mutations on archived events globally.
    // Routes that must work on archived events (deletion-request flow, super-admin)
    // opt out with @AllowOnArchivedEvent().
    {
      provide: APP_GUARD,
      useClass: EventReadOnlyGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: LockdownInterceptor,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    if (process.env['NODE_ENV'] === 'test') return;
    consumer.apply(RequestLoggingMiddleware).forRoutes('*');
  }
}
