import { Module } from '@nestjs/common';
import { CsvImportService } from './csv-import.service';
import { LookupController } from './lookup.controller';
import { PersonEmailChangeController } from './person-email-change.controller';
import { PersonEmailChangeService } from './person-email-change.service';
import { PersonsController } from './persons.controller';
import { PersonsService } from './persons.service';
import { PrivacyController } from './privacy.controller';
import { PrivacyService } from './privacy.service';
import { PublicScheduleController } from './public-schedule.controller';
import { PublicScheduleService } from './public-schedule.service';
import { AuthModule } from '../auth/auth.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { RegistrationsModule } from '../registrations/registrations.module';
import { IdentityModule } from '../identity/identity.module';
import { NotificationSchedulingModule } from '../notifications/notification-scheduling.module';

@Module({
  // OrganizationsModule imports only UserDirectoryModule (@Global, SupabaseService
  // alone) and PrivacyModule (imports nothing), so this edge cannot form a cycle.
  // NotificationSchedulingModule is a leaf too (it imports only its own queue): the privacy
  // controller removes a follower's waiting alerts through it (ruling 208).
  imports: [
    AuthModule,
    OrganizationsModule,
    RegistrationsModule,
    IdentityModule,
    NotificationSchedulingModule,
  ],
  controllers: [
    PersonsController,
    LookupController,
    PublicScheduleController,
    PrivacyController,
    PersonEmailChangeController,
  ],
  providers: [
    PersonsService,
    CsvImportService,
    PrivacyService,
    PublicScheduleService,
    PersonEmailChangeService,
  ],
  exports: [PersonsService, CsvImportService, PrivacyService, PublicScheduleService],
})
export class PersonsModule {}
