import { Module } from '@nestjs/common';
import { HemaRatingsModule } from '../hema-ratings/hema-ratings.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { SupabaseModule } from '../supabase/supabase.module';
import { SwissCoreModule } from './swiss-core.module';
import { SwissStandingsController } from './swiss-standings.controller';
import { SwissController } from './swiss.controller';
import { SwissFinaliseService } from './swiss-finalise.service';
import { SwissOverrideService } from './swiss-override.service';
import { SwissSeedingService } from './swiss-seeding.service';
import { SwissService } from './swiss.service';

/**
 * The organiser-facing Swiss module: generate, configure, override, finalise.
 *
 * Everything a completed match needs to reach lives in SwissCoreModule instead,
 * because PhasesModule imports that leaf for auto-advance. This module may
 * safely import PhasesModule if it ever needs to — SwissCoreModule imports
 * nothing back, so `SwissModule → PhasesModule → SwissCoreModule` is a path,
 * not a cycle. What it must never do is let the LEAF grow an edge that returns
 * here; module-graph.test.ts pins that.
 */
@Module({
  imports: [SupabaseModule, SwissCoreModule, HemaRatingsModule, OrganizationsModule],
  controllers: [SwissController, SwissStandingsController],
  providers: [SwissService, SwissSeedingService, SwissOverrideService, SwissFinaliseService],
  exports: [SwissService, SwissOverrideService, SwissFinaliseService],
})
export class SwissModule {}
