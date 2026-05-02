import { Module } from '@nestjs/common';
import { ConflictCheckController } from './conflict-check.controller';
import { PhasesController } from './phases.controller';
import { PhasesService } from './phases.service';
import { PoolPopulatorController } from './pool-populator.controller';
import { RefereesModule } from '../referees/referees.module';
import { HemaRatingsModule } from '../hema-ratings/hema-ratings.module';

@Module({
  imports: [RefereesModule, HemaRatingsModule],
  controllers: [PhasesController, ConflictCheckController, PoolPopulatorController],
  providers: [PhasesService],
  exports: [PhasesService],
})
export class PhasesModule {}
