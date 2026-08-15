import { Module } from '@nestjs/common';
import { OrganizationsModule } from '../organizations/organizations.module';
import { NotificationSchedulingModule } from '../notifications/notification-scheduling.module';
import { AssignmentBoardController } from './assignment-board.controller';
import { AssignmentBoardService } from './assignment-board.service';
import { AutoAssignController } from './auto-assign.controller';
import { QualificationsController } from './qualifications.controller';
import { QualificationsService } from './qualifications.service';
import { RefereeMatchAssignmentsController } from './referee-match-assignments.controller';
import { RefereeMatchAssignmentsService } from './referee-match-assignments.service';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { StaffingController } from './staffing.controller';
import { StaffingService } from './staffing.service';

@Module({
  // Imports the focused NotificationSchedulingModule leaf — NOT WorkersModule.
  // AutoAssignController needs the notification-scheduler services, but importing
  // all of WorkersModule closed a module cycle
  //   WorkersModule → LeaguesModule → … → PhasesModule → RefereesModule → WorkersModule
  // that crashed the API at boot. See module-graph.test.ts.
  imports: [OrganizationsModule, NotificationSchedulingModule],
  controllers: [
    QualificationsController,
    SettingsController,
    AutoAssignController,
    AssignmentBoardController,
    RefereeMatchAssignmentsController,
    StaffingController,
  ],
  providers: [
    QualificationsService,
    SettingsService,
    AssignmentBoardService,
    RefereeMatchAssignmentsService,
    StaffingService,
  ],
  exports: [QualificationsService, SettingsService, StaffingService],
})
export class RefereesModule {}
