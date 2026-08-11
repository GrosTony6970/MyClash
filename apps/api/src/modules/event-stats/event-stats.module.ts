import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { AuthModule } from '../auth/auth.module';
import { EventsModule } from '../events/events.module';
import { StatsModule } from '../stats/stats.module';
import { PoolStandingsModule } from '../pool-standings/pool-standings.module';
import { EventStatsController } from './event-stats.controller';
import { EventStatsService } from './event-stats.service';
import { EventFeedbackService } from './event-feedback.service';

@Module({
  imports: [
    SupabaseModule,
    OrganizationsModule,
    AuthModule,
    EventsModule,
    StatsModule,
    PoolStandingsModule,
  ],
  controllers: [EventStatsController],
  providers: [EventStatsService, EventFeedbackService],
  exports: [EventStatsService, EventFeedbackService],
})
export class EventStatsModule {}
