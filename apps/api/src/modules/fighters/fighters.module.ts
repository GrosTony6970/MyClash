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
import { TournamentPlacementModule } from '../tournament-placement/tournament-placement.module';
import { PrivacyModule } from '../privacy/privacy.module';

@Module({
  // TournamentPlacementModule provides the shared placement service used to
  // compute career placements (computeFinalRanking parity with leagues + public).
  // PrivacyModule is a leaf (imports nothing), so its edge cannot form a cycle;
  // getBySlug uses ErasureService to answer 410 on a retired slug.
  imports: [HemaRatingsModule, AdminModule, TournamentPlacementModule, PrivacyModule],
  controllers: [FightersController, WeaponsController, GlobalPersonsController],
  providers: [FightersService, FighterMergeService, CsvImportService],
  exports: [FightersService],
})
export class FightersModule {}
