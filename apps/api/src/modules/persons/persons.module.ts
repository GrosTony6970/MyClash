import { Module } from '@nestjs/common';
import { CsvImportService } from './csv-import.service';
import { LookupController } from './lookup.controller';
import { PersonsController } from './persons.controller';
import { PersonsService } from './persons.service';
import { PrivacyController } from './privacy.controller';
import { PrivacyService } from './privacy.service';
import { PublicScheduleController } from './public-schedule.controller';
import { PublicScheduleService } from './public-schedule.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [PersonsController, LookupController, PublicScheduleController, PrivacyController],
  providers: [PersonsService, CsvImportService, PrivacyService, PublicScheduleService],
  exports: [PersonsService, CsvImportService, PrivacyService, PublicScheduleService],
})
export class PersonsModule {}
