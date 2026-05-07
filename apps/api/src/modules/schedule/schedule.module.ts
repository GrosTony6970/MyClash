import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PersonsModule } from '../persons/persons.module';
import { SupabaseModule } from '../supabase/supabase.module';
import { MyScheduleController } from './my-schedule.controller';
import { LiveStateController } from './live-state.controller';
import { LiveStateService } from './live-state.service';

@Module({
  imports: [AuthModule, PersonsModule, SupabaseModule],
  controllers: [MyScheduleController, LiveStateController],
  providers: [LiveStateService],
})
export class ScheduleModule {}
