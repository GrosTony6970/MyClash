import { Module } from '@nestjs/common';
import { OrganizationsModule } from '../organizations/organizations.module';
import { DeletionRequestsController } from './deletion-requests.controller';
import { DeletionRequestsService } from './deletion-requests.service';

@Module({
  imports: [OrganizationsModule],
  controllers: [DeletionRequestsController],
  providers: [DeletionRequestsService],
})
export class DeletionRequestsModule {}
