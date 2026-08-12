import { Module } from '@nestjs/common';
import { FrozenResultsModule } from '../matches/frozen-results.module';
import { MatchesModule } from '../matches/matches.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { RulesetHashModule } from '../ruleset-hash/ruleset-hash.module';
import { StaffModule } from '../staff/staff.module';
import { SupabaseModule } from '../supabase/supabase.module';
import { PenaltiesController } from './penalties.controller';
import { PenaltiesService } from './penalties.service';

@Module({
  // FrozenResultsModule directly, not via MatchesModule: the guard is a leaf
  // now so that a phase-side owner can reach it without closing a cycle.
  imports: [
    SupabaseModule,
    MatchesModule,
    FrozenResultsModule,
    OrganizationsModule,
    StaffModule,
    RulesetHashModule,
  ],
  controllers: [PenaltiesController],
  providers: [PenaltiesService],
  exports: [PenaltiesService],
})
export class PenaltiesModule {}
