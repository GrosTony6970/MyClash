import { Module } from '@nestjs/common';
import { OrganizationsModule } from '../organizations/organizations.module';
import { PhasesModule } from '../phases/phases.module';
import { RulesetResolverModule } from '../matches/ruleset-resolver.module';
import { SupabaseModule } from '../supabase/supabase.module';
import { StaffController } from './staff.controller';
import { StaffJwtService } from './staff-jwt.service';
import { StaffService } from './staff.service';

@Module({
  // PhasesModule: the piste screen's pool + bracket views delegate to
  // PhasesService rather than pointing the tablet at /tournaments/:id/*, which
  // asserts nothing about which event the caller belongs to. Nothing under
  // PhasesModule imports StaffModule or MatchesModule, so this closes no cycle
  // — but a cycle only throws at real boot, so keep it that way.
  // RulesetResolverModule: a leaf (its own module so no feature module cycles
  // over it); the piste read-ahead sends each bout's edition with it.
  imports: [SupabaseModule, OrganizationsModule, PhasesModule, RulesetResolverModule],
  controllers: [StaffController],
  providers: [StaffService, StaffJwtService],
  exports: [StaffService, StaffJwtService],
})
export class StaffModule {}
