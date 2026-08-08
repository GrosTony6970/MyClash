import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MailModule } from '../mail/mail.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { StaffModule } from '../staff/staff.module';
import { SupabaseModule } from '../supabase/supabase.module';
import { CheckinController } from './checkin.controller';
import { CheckinService } from './checkin.service';
import { GearController } from './gear.controller';
import { GearService } from './gear.service';
import { PassController } from './pass.controller';
import { PassEmailService } from './pass-email.service';
import { PassService } from './pass.service';

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
  // StaffModule for `requireStaffWithRole`, AuthModule for
  // `ParticipantIdentityService` (the participant issuing their own pass is a
  // claimed user or a guest, never staff). Both edges point one way — neither
  // module knows about these desks — so this closes no cycle. Keep it that way:
  // a module cycle throws only at real boot, never in a unit test.
  // MailModule + OrganizationsModule are for the pass mail-out only: it needs a
  // mailer and `assertOrgRole`. Neither knows about these desks either, so the
  // module graph stays a DAG.
  imports: [SupabaseModule, StaffModule, AuthModule, MailModule, OrganizationsModule],
  controllers: [CheckinController, GearController, PassController],
  providers: [CheckinService, GearService, PassService, PassEmailService],
})
export class CheckinModule {}
