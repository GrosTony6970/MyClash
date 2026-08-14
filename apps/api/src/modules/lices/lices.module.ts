import { Module } from '@nestjs/common';
import { LicesController } from './lices.controller';
import { LicesService } from './lices.service';
import { OrganizationsModule } from '../organizations/organizations.module';

@Module({
  // OrganizationsModule imports only UserDirectoryModule + PrivacyModule, so
  // this edge cannot form a cycle.
  imports: [OrganizationsModule],
  controllers: [LicesController],
  providers: [LicesService],
  exports: [LicesService],
})
export class LicesModule {}
