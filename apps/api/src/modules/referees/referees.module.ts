import { Module } from '@nestjs/common';
import { OrganizationsModule } from '../organizations/organizations.module';
import { WorkersModule } from '../../workers/workers.module';
import { AssignmentBoardController } from './assignment-board.controller';
import { AssignmentBoardService } from './assignment-board.service';
import { AutoAssignController } from './auto-assign.controller';
import { QualificationsController } from './qualifications.controller';
import { QualificationsService } from './qualifications.service';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { StaffingController } from './staffing.controller';
import { StaffingService } from './staffing.service';

@Module({
  imports: [OrganizationsModule, WorkersModule],
  controllers: [
    QualificationsController,
    SettingsController,
    AutoAssignController,
    AssignmentBoardController,
    StaffingController,
  ],
  providers: [QualificationsService, SettingsService, AssignmentBoardService, StaffingService],
  exports: [QualificationsService, SettingsService, StaffingService],
})
export class RefereesModule {}
