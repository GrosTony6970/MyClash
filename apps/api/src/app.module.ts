import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './modules/auth/auth.module';
import { HealthModule } from './modules/health/health.module';
import { MailModule } from './modules/mail/mail.module';
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
        ttl: 60_000,   // 1 minute window
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
    AuthModule,
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
