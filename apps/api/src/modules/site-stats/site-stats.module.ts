import { Module } from '@nestjs/common';
import { SiteStatsController } from './site-stats.controller';
import { SiteStatsService } from './site-stats.service';

// SupabaseModule is @Global, so SupabaseService needs no import here.
@Module({
  controllers: [SiteStatsController],
  providers: [SiteStatsService],
})
export class SiteStatsModule {}
