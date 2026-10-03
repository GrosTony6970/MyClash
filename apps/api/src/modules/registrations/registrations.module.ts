import { Module } from '@nestjs/common';
import { RegistrationsController } from './registrations.controller';
import { RegistrationsService } from './registrations.service';
import { AssignmentsService } from './assignments.service';
import { IdentityModule } from '../identity/identity.module';
import { NotificationSchedulingModule } from '../notifications/notification-scheduling.module';
import { OrganizationsModule } from '../organizations/organizations.module';

@Module({
  // OrganizationsModule imports only UserDirectoryModule and PrivacyModule, so
  // this edge cannot form a cycle (the same edge PersonsModule has).
  // NotificationSchedulingModule is a leaf (no import but its queue): no cycle either.
  imports: [IdentityModule, OrganizationsModule, NotificationSchedulingModule],
  controllers: [RegistrationsController],
  providers: [RegistrationsService, AssignmentsService],
  exports: [RegistrationsService, AssignmentsService],
})
export class RegistrationsModule {}
