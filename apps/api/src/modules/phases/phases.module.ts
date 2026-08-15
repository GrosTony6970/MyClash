import { Module } from '@nestjs/common';
import { FrozenResultsModule } from '../matches/frozen-results.module';
import { BracketAdvanceService } from './bracket-advance.service';
import { BracketSlotsController } from './bracket-slots.controller';
import { ConflictCheckController } from './conflict-check.controller';
import { MatchCompletionService } from './match-completion.service';
import { PhasesController } from './phases.controller';
import { PhasesService } from './phases.service';
import { RefereesModule } from '../referees/referees.module';
import { HemaRatingsModule } from '../hema-ratings/hema-ratings.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { PoolStandingsModule } from '../pool-standings/pool-standings.module';
import { SwissCoreModule } from '../swiss/swiss-core.module';
import { NotificationSchedulingModule } from '../notifications/notification-scheduling.module';

@Module({
  // SwissCoreModule, never SwissModule: MatchCompletionService has to invoke
  // Swiss pairing for auto-advance, and only the leaf can be depended on
  // without closing a module cycle. See swiss-core.module.ts.
  // FrozenResultsModule, not MatchesModule: MatchCompletionService injects the
  // freeze non-optionally and MatchesModule imports THIS module, so reaching it
  // any other way closes the cycle module-graph.test.ts fails on.
  // NotificationSchedulingModule is the notification LEAF, not WorkersModule:
  // the two pool-reschedule routes here write match times and must refresh the
  // alerts built from them, and WorkersModule imports LeaguesModule, which
  // reaches back into this module. The leaf has no import edges that re-enter
  // the graph — that is why it was cut out. See its header.
  imports: [
    FrozenResultsModule,
    RefereesModule,
    HemaRatingsModule,
    OrganizationsModule,
    PoolStandingsModule,
    SwissCoreModule,
    NotificationSchedulingModule,
  ],
  controllers: [PhasesController, ConflictCheckController, BracketSlotsController],
  providers: [PhasesService, BracketAdvanceService, MatchCompletionService],
  exports: [PhasesService, BracketAdvanceService, MatchCompletionService],
})
export class PhasesModule {}
