import { Module } from '@nestjs/common';
import { WorkersModule } from '../../workers/workers.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { LeaguesModule } from '../leagues/leagues.module';
import { ClubsModule } from '../clubs/clubs.module';
import { HemaRatingsModule } from '../hema-ratings/hema-ratings.module';
import { PoolStandingsModule } from '../pool-standings/pool-standings.module';
import { RulesetResolverModule } from '../matches/ruleset-resolver.module';
import { RulesetHashModule } from '../ruleset-hash/ruleset-hash.module';
import { EventsController } from './events.controller';
import { EventThemesService } from './event-themes.service';
import { EventsService } from './events.service';
import { ClockReconciliationService } from './clock-reconciliation.service';

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
    // RulesetResolver — the re-pin rejects a target that won't resolve for
    // scoring. Dependency-light (Supabase only), so no cycle.
    RulesetResolverModule,
    // RulesetHashService — stamps the tournament's effective content-hash on
    // create/update/re-pin. Leaf module (Supabase only), so no cycle.
    RulesetHashModule,
  ],
  controllers: [EventsController],
  providers: [EventsService, EventThemesService, ClockReconciliationService],
  exports: [EventsService, EventThemesService],
})
export class EventsModule {}
