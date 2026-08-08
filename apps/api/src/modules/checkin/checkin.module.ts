import { Module } from '@nestjs/common';
import { StaffModule } from '../staff/staff.module';
import { SupabaseModule } from '../supabase/supabase.module';
import { CheckinController } from './checkin.controller';
import { CheckinService } from './checkin.service';

@Module({
  // StaffModule for `requireStaffWithRole` only. The edge points one way —
  // StaffModule knows nothing about check-in — so this closes no cycle. Keep it
  // that way: a module cycle throws only at real boot, never in a unit test.
  imports: [SupabaseModule, StaffModule],
  controllers: [CheckinController],
  providers: [CheckinService],
})
export class CheckinModule {}
