import { Module } from '@nestjs/common';
import { FrozenResultsModule } from '../matches/frozen-results.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { StaffModule } from '../staff/staff.module';
import { SupabaseModule } from '../supabase/supabase.module';
import { ProtestsController } from './protests.controller';
import { ProtestsService } from './protests.service';

@Module({
  // FrozenResultsModule is the only provider of the over-Event guard, which the service takes
  // REQUIRED: dropped from here, the API fails to start rather than taking protests in silence.
  imports: [SupabaseModule, FrozenResultsModule, OrganizationsModule, StaffModule],
  controllers: [ProtestsController],
  providers: [ProtestsService],
})
export class ProtestsModule {}
