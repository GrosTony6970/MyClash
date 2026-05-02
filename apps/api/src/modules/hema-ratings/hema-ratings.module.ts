import { Module } from '@nestjs/common';
import { HemaRatingsController } from './hema-ratings.controller';
import { HemaRatingsService } from './hema-ratings.service';

@Module({
  controllers: [HemaRatingsController],
  providers: [HemaRatingsService],
  exports: [HemaRatingsService],
})
export class HemaRatingsModule {}
