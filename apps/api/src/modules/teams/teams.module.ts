import { Module } from '@nestjs/common';
import { OrganizationsModule } from '../organizations/organizations.module';
import { TeamsController } from './teams.controller';
import { TeamsService } from './teams.service';

@Module({
  // OrganizationsModule imports only UserDirectoryModule and PrivacyModule: no cycle.
  imports: [OrganizationsModule],
  controllers: [TeamsController],
  providers: [TeamsService],
})
export class TeamsModule {}
