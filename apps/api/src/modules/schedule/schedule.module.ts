import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MatchPlacementModule } from '../matches/match-placement.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { PersonsModule } from '../persons/persons.module';
import { SupabaseModule } from '../supabase/supabase.module';
import { MyScheduleController } from './my-schedule.controller';
import { LiveStateController } from './live-state.controller';
import { LiveStateService } from './live-state.service';
import { ScheduleGridController } from './schedule-grid.controller';
import { ScheduleGridService } from './schedule-grid.service';
import { ScheduleRunController } from './schedule-run.controller';
import { ScheduleRunService } from './schedule-run.service';

@Module({
  // OrganizationsModule imports only UserDirectoryModule (@Global, SupabaseService
  // alone) and PrivacyModule (imports nothing), so this edge cannot form a cycle —
  // the same reasoning programme.module.ts carries. MatchPlacementModule is a
  // leaf built to be imported by every door that places a Match.
  imports: [AuthModule, MatchPlacementModule, OrganizationsModule, PersonsModule, SupabaseModule],
  controllers: [
    MyScheduleController,
    LiveStateController,
    ScheduleGridController,
    ScheduleRunController,
  ],
  providers: [LiveStateService, ScheduleGridService, ScheduleRunService],
})
export class ScheduleModule {}
