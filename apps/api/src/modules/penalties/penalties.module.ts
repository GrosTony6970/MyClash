import { Module } from '@nestjs/common';
import { MatchesModule } from '../matches/matches.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { StaffModule } from '../staff/staff.module';
import { SupabaseModule } from '../supabase/supabase.module';
import { PenaltiesController } from './penalties.controller';
import { PenaltiesService } from './penalties.service';

@Module({
  imports: [SupabaseModule, MatchesModule, OrganizationsModule, StaffModule],
  controllers: [PenaltiesController],
  providers: [PenaltiesService],
  exports: [PenaltiesService],
})
export class PenaltiesModule {}
