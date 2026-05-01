import { Module } from '@nestjs/common';
import { QualificationsController } from './qualifications.controller';
import { QualificationsService } from './qualifications.service';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';

@Module({
  controllers: [QualificationsController, SettingsController],
  providers: [QualificationsService, SettingsService],
  exports: [QualificationsService, SettingsService],
})
export class RefereesModule {}
