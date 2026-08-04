import { Module } from '@nestjs/common';
import { OrganizationsModule } from '../organizations/organizations.module';
import { PhasesModule } from '../phases/phases.module';
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
  imports: [SupabaseModule, OrganizationsModule, PhasesModule],
  controllers: [StaffController],
  providers: [StaffService, StaffJwtService],
  exports: [StaffService, StaffJwtService],
})
export class StaffModule {}
