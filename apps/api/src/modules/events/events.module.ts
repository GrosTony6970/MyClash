import { Module } from '@nestjs/common';
import { WorkersModule } from '../../workers/workers.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { LeaguesModule } from '../leagues/leagues.module';
import { ClubsModule } from '../clubs/clubs.module';
import { HemaRatingsModule } from '../hema-ratings/hema-ratings.module';
import { PoolStandingsModule } from '../pool-standings/pool-standings.module';
import { EventsController } from './events.controller';
import { EventThemesService } from './event-themes.service';
import { EventsService } from './events.service';

@Module({
  imports: [
    OrganizationsModule,
    WorkersModule,
    LeaguesModule,
    ClubsModule,
    HemaRatingsModule,
    // Supplies PoolStandingsService for the audited ruleset re-pin's before/
    // after placings snapshot. Acyclic: PoolStandings depends only on Supabase
    // + RulesetResolver (guarded by module-graph.test.ts).
    PoolStandingsModule,
  ],
  controllers: [EventsController],
  providers: [EventsService, EventThemesService],
  exports: [EventsService, EventThemesService],
})
export class EventsModule {}
