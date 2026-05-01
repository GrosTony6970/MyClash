import { Module } from '@nestjs/common';
import { ConflictCheckController } from './conflict-check.controller';
import { PhasesController } from './phases.controller';
import { PhasesService } from './phases.service';
import { PoolPopulatorController } from './pool-populator.controller';
import { RefereesModule } from '../referees/referees.module';

@Module({
  imports: [RefereesModule],
  controllers: [PhasesController, ConflictCheckController, PoolPopulatorController],
  providers: [PhasesService],
  exports: [PhasesService],
})
export class PhasesModule {}
