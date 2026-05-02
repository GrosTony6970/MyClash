import { Module } from '@nestjs/common';
import { WorkersModule } from '../../workers/workers.module';
import { AutoAssignController } from './auto-assign.controller';
import { QualificationsController } from './qualifications.controller';
import { QualificationsService } from './qualifications.service';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';

@Module({
  imports: [WorkersModule],
  controllers: [QualificationsController, SettingsController, AutoAssignController],
  providers: [QualificationsService, SettingsService],
  exports: [QualificationsService, SettingsService],
})
export class RefereesModule {}
