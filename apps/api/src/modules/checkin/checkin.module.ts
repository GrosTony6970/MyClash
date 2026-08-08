import { Module } from '@nestjs/common';
import { StaffModule } from '../staff/staff.module';
import { SupabaseModule } from '../supabase/supabase.module';
import { CheckinController } from './checkin.controller';
import { CheckinService } from './checkin.service';
import { GearController } from './gear.controller';
import { GearService } from './gear.service';

/**
 * The two event-day desks: check-in and gear check.
 *
 * One module because they are one screen with different action strips — they
 * share `queryEventRoster`, and both answer "who is this person in front of
 * me?" before anything else. Splitting them would duplicate the photo/club
 * resolution that stops a volunteer processing the wrong Marie.
 *
 * Their ROLES are separate and enforced separately: `checkin` cannot record a
 * gear pass and `gear` cannot mark an arrival.
 */
@Module({
  // StaffModule for `requireStaffWithRole` only. The edge points one way —
  // StaffModule knows nothing about these desks — so this closes no cycle. Keep
  // it that way: a module cycle throws only at real boot, never in a unit test.
  imports: [SupabaseModule, StaffModule],
  controllers: [CheckinController, GearController],
  providers: [CheckinService, GearService],
})
export class CheckinModule {}
