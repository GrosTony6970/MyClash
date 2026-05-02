import { Module } from '@nestjs/common';
import { FightersController } from './fighters.controller';
import { FightersService } from './fighters.service';
import { HemaRatingsModule } from '../hema-ratings/hema-ratings.module';

@Module({
  imports: [HemaRatingsModule],
  controllers: [FightersController],
  providers: [FightersService],
  exports: [FightersService],
})
export class FightersModule {}
