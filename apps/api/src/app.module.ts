import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
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
import { StatsModule } from './modules/stats/stats.module';
import { ExportsModule } from './modules/exports/exports.module';
import { WorkersModule } from './workers/workers.module';
import { LicesModule } from './modules/lices/lices.module';
import { LeaguesModule } from './modules/leagues/leagues.module';
import { MailModule } from './modules/mail/mail.module';
import { MatchesModule } from './modules/matches/matches.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { PersonsModule } from './modules/persons/persons.module';
import { PenaltiesModule } from './modules/penalties/penalties.module';
import { PhasesModule } from './modules/phases/phases.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { RegistrationsModule } from './modules/registrations/registrations.module';
import { SupabaseModule } from './modules/supabase/supabase.module';

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
    // Auth endpoints override this with stricter limits via @Throttle().
    ThrottlerModule.forRoot([
      {
        name: 'global',
        ttl: 60_000, // 1 minute window
        limit: 60,
      },
      {
        // Stricter limit for magic-link requests: 10 per hour per IP
        name: 'auth',
        ttl: 3_600_000, // 1 hour window
        limit: 10,
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
    FightersModule,
    EventsModule,
    LicesModule,
    LeaguesModule,
    PenaltiesModule,
    RegistrationsModule,
    MatchesModule,
    NotificationsModule,
    PhasesModule,
    FollowsModule,
    WorkshopsModule,
    ScheduleModule,
    RefereesModule,
    StatsModule,
    ExportsModule,
    WorkersModule,
    RealtimeModule,
  ],
  providers: [
    // Apply ThrottlerGuard globally — individual controllers can override
    // with @SkipThrottle() or @Throttle({ auth: { limit: 3, ttl: 3600000 } })
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
