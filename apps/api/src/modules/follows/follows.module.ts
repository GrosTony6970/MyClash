import { Module } from '@nestjs/common';
import { WorkersModule } from '../../workers/workers.module';
import { AuthModule } from '../auth/auth.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { PersonsModule } from '../persons/persons.module';
import { FollowsController } from './follows.controller';
import { FollowsService } from './follows.service';
import { OrganizationFollowsService } from './organization-follows.service';
import { PublicPersonController } from './public-person.controller';
import { PublicPersonService } from './public-person.service';

@Module({
  // OrganizationsModule imports only UserDirectoryModule and PrivacyModule, so this edge cannot
  // form a cycle (see persons.module.ts).
  imports: [AuthModule, OrganizationsModule, PersonsModule, WorkersModule],
  controllers: [FollowsController, PublicPersonController],
  providers: [FollowsService, OrganizationFollowsService, PublicPersonService],
  exports: [FollowsService, OrganizationFollowsService],
})
export class FollowsModule {}
