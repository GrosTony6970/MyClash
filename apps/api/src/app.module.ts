import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AdminModule } from './modules/admin/admin.module';
import { AuthModule } from './modules/auth/auth.module';
import { PrivacyModule } from './modules/privacy/privacy.module';
import { ClubsModule } from './modules/clubs/clubs.module';
import { EventsModule } from './modules/events/events.module';
import { FightersModule } from './modules/fighters/fighters.module';
import { FollowsModule } from './modules/follows/follows.module';
import { DirectoryGroupsModule } from './modules/directory-groups/directory-groups.module';
import { HealthModule } from './modules/health/health.module';
import { HemaRatingsModule } from './modules/hema-ratings/hema-ratings.module';
import { MeModule } from './modules/me/me.module';
import { WorkshopsModule } from './modules/workshops/workshops.module';
import { ScheduleModule } from './modules/schedule/schedule.module';
import { RefereesModule } from './modules/referees/referees.module';
import { DeletionRequestsModule } from './modules/deletion-requests/deletion-requests.module';
import { ReviewQueueModule } from './modules/admin/review-queue.module';
import { StatsModule } from './modules/stats/stats.module';
import { EventStatsModule } from './modules/event-stats/event-stats.module';
import { StaffModule } from './modules/staff/staff.module';
import { CheckinModule } from './modules/checkin/checkin.module';
import { ExportsModule } from './modules/exports/exports.module';
import { WorkersModule } from './workers/workers.module';
import { LicesModule } from './modules/lices/lices.module';
import { VenuesModule } from './modules/venues/venues.module';
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
import { SwissModule } from './modules/swiss/swiss.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { RegistrationsModule } from './modules/registrations/registrations.module';
import { RulesetsModule } from './modules/rulesets/rulesets.module';
import { SupabaseModule } from './modules/supabase/supabase.module';
import { EntityLabelModule } from './modules/entity-label/entity-label.module';
import { UserDirectoryModule } from './modules/user-directory/user-directory.module';
import { OrganizerAIAssistantModule } from './modules/organizer-ai-assistant/organizer-ai-assistant.module';
import { OrganizerChatModule } from './modules/organizer-chat/organizer-chat.module';
import { GeneratedContentModule } from './modules/generated-content/generated-content.module';
import { TournamentQueryModule } from './modules/tournament-query/tournament-query.module';
import { PoolStandingsModule } from './modules/pool-standings/pool-standings.module';
import { PeopleContextModule } from './modules/people-context/people-context.module';
import { RequestLoggingMiddleware } from './common/observability/request-logging.middleware';
import { LockdownInterceptor } from './common/interceptors/lockdown.interceptor';
import { ReadOnlyInterceptor } from './common/interceptors/read-only.interceptor';
import { AuthGuard } from './common/auth/auth.guard';
import { EventReadOnlyGuard } from './common/event-readonly/event-readonly.guard';
import { throttlerOptions } from './common/throttling/throttler-options';

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
    ThrottlerModule.forRoot(throttlerOptions),

    // ── Infrastructure ───────────────────────────────────────────────────
    SupabaseModule,
    UserDirectoryModule,
    EntityLabelModule,
    MailModule,

    // ── Feature modules ──────────────────────────────────────────────────
    HealthModule,
    HemaRatingsModule,
    AuthModule,
    AdminModule,
    MeModule,
    PrivacyModule,
    PersonsModule,
    ClubsModule,
    CompensationModule,
    FightersModule,
    EventsModule,
    LicesModule,
    VenuesModule,
    LeaguesModule,
    PenaltiesModule,
    RegistrationsModule,
    MatchesModule,
    NotificationsModule,
    PhasesModule,
    ProgrammeModule,
    SwissModule,
    AIProvidersModule,
    AIUsageModule,
    OrganizerAIAssistantModule,
    OrganizerChatModule,
    GeneratedContentModule,
    TournamentQueryModule,
    FollowsModule,
    DirectoryGroupsModule,
    WorkshopsModule,
    ScheduleModule,
    RefereesModule,
    DeletionRequestsModule,
    ReviewQueueModule,
    StaffModule,
    CheckinModule,
    StatsModule,
    EventStatsModule,
    ExportsModule,
    WorkersModule,
    RealtimeModule,
    RulesetsModule,
    PoolStandingsModule,
    PeopleContextModule,
  ],
  providers: [
    // Apply ThrottlerGuard globally — individual controllers can override
    // with @SkipThrottle() or @Throttle({ global: { limit: 600, ttl: 60000 } })
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    // Authenticate every request. A route without @Public() requires an
    // identity; forgetting a guard now fails closed instead of open.
    //
    // Ordering is deliberate — globals run in provider-array order, so this sits
    // after ThrottlerGuard (an unauthenticated flood should still be rate
    // limited first) and before EventReadOnlyGuard ("who are you?" precedes
    // "is this event archived?", and it saves that guard's chained lookups on
    // requests that are about to 401 anyway).
    //
    // Defaults to AUTH_GUARD_MODE=shadow: it logs the 401 it would have thrown
    // and lets the request through. Flip to 'enforce' only once the shadow logs
    // are clean; the env var is the rollback.
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
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
    {
      provide: APP_INTERCEPTOR,
      useClass: ReadOnlyInterceptor,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    if (process.env['NODE_ENV'] === 'test') return;
    consumer.apply(RequestLoggingMiddleware).forRoutes('*');
  }
}
