import { Module } from '@nestjs/common';
import { ProgrammeController } from './programme.controller';
import { ProgrammeService } from './programme.service';
import { OrganizationsModule } from '../organizations/organizations.module';

@Module({
  // OrganizationsModule imports only UserDirectoryModule + PrivacyModule, so
  // this edge cannot form a cycle.
  imports: [OrganizationsModule],
  controllers: [ProgrammeController],
  providers: [ProgrammeService],
  exports: [ProgrammeService],
})
export class ProgrammeModule {}
