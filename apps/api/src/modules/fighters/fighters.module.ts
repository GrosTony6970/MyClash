import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { FightersController, WeaponsController } from './fighters.controller';
import { FightersService } from './fighters.service';
import { HemaRatingsModule } from '../hema-ratings/hema-ratings.module';
import { FighterMergeService } from './merge.service';

@Module({
  imports: [HemaRatingsModule, AdminModule],
  controllers: [FightersController, WeaponsController],
  providers: [FightersService, FighterMergeService],
  exports: [FightersService],
})
export class FightersModule {}
