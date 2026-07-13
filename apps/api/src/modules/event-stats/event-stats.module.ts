import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { EventsModule } from '../events/events.module';
import { StatsModule } from '../stats/stats.module';
import { PoolStandingsModule } from '../pool-standings/pool-standings.module';
import { EventStatsController } from './event-stats.controller';
import { EventStatsService } from './event-stats.service';

@Module({
  imports: [SupabaseModule, OrganizationsModule, EventsModule, StatsModule, PoolStandingsModule],
  controllers: [EventStatsController],
  providers: [EventStatsService],
  exports: [EventStatsService],
})
export class EventStatsModule {}
