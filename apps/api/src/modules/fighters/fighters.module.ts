import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import {
  FightersController,
  GlobalPersonsController,
  WeaponsController,
} from './fighters.controller';
import { FightersService } from './fighters.service';
import { HemaRatingsModule } from '../hema-ratings/hema-ratings.module';
import { FighterMergeService } from './merge.service';
import { CsvImportService } from '../persons/csv-import.service';
import { PhasesModule } from '../phases/phases.module';
import { PoolStandingsModule } from '../pool-standings/pool-standings.module';

@Module({
  // PhasesModule + PoolStandingsModule provide the bracket + pool-standings
  // services used to compute career placements (computeFinalRanking parity).
  imports: [HemaRatingsModule, AdminModule, PhasesModule, PoolStandingsModule],
  controllers: [FightersController, WeaponsController, GlobalPersonsController],
  providers: [FightersService, FighterMergeService, CsvImportService],
  exports: [FightersService],
})
export class FightersModule {}
