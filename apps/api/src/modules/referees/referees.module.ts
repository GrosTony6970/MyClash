import { Module } from '@nestjs/common';
import { OrganizationsModule } from '../organizations/organizations.module';
import { WorkersModule } from '../../workers/workers.module';
import { AutoAssignController } from './auto-assign.controller';
import { QualificationsController } from './qualifications.controller';
import { QualificationsService } from './qualifications.service';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';

@Module({
  imports: [OrganizationsModule, WorkersModule],
  controllers: [QualificationsController, SettingsController, AutoAssignController],
  providers: [QualificationsService, SettingsService],
  exports: [QualificationsService, SettingsService],
})
export class RefereesModule {}
