import { Module } from '@nestjs/common';
import { BracketAdvanceService } from './bracket-advance.service';
import { BracketSlotsController } from './bracket-slots.controller';
import { ConflictCheckController } from './conflict-check.controller';
import { PhasesController } from './phases.controller';
import { PhasesService } from './phases.service';
import { PoolPopulatorController } from './pool-populator.controller';
import { RefereesModule } from '../referees/referees.module';
import { HemaRatingsModule } from '../hema-ratings/hema-ratings.module';
import { OrganizationsModule } from '../organizations/organizations.module';

@Module({
  imports: [RefereesModule, HemaRatingsModule, OrganizationsModule],
  controllers: [
    PhasesController,
    ConflictCheckController,
    PoolPopulatorController,
    BracketSlotsController,
  ],
  providers: [PhasesService, BracketAdvanceService],
  exports: [PhasesService, BracketAdvanceService],
})
export class PhasesModule {}
