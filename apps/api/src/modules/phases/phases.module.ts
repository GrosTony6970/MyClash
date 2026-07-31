import { Module } from '@nestjs/common';
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

@Module({
  // SwissCoreModule, never SwissModule: MatchCompletionService has to invoke
  // Swiss pairing for auto-advance, and only the leaf can be depended on
  // without closing a module cycle. See swiss-core.module.ts.
  imports: [
    RefereesModule,
    HemaRatingsModule,
    OrganizationsModule,
    PoolStandingsModule,
    SwissCoreModule,
  ],
  controllers: [PhasesController, ConflictCheckController, BracketSlotsController],
  providers: [PhasesService, BracketAdvanceService, MatchCompletionService],
  exports: [PhasesService, BracketAdvanceService, MatchCompletionService],
})
export class PhasesModule {}
