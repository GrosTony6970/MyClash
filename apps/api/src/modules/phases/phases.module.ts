import { Module } from '@nestjs/common';
import { ConflictCheckController } from './conflict-check.controller';
import { PhasesController } from './phases.controller';
import { PhasesService } from './phases.service';

@Module({
  controllers: [PhasesController, ConflictCheckController],
  providers: [PhasesService],
  exports: [PhasesService],
})
export class PhasesModule {}
