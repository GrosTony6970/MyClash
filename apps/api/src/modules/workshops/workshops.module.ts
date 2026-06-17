import { Module } from '@nestjs/common';
import { WorkersModule } from '../../workers/workers.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { EnrollmentService } from './enrollment.service';
import { WorkshopsController } from './workshops.controller';
import { WorkshopsService } from './workshops.service';

@Module({
  imports: [WorkersModule, OrganizationsModule],
  controllers: [WorkshopsController],
  providers: [WorkshopsService, EnrollmentService],
  exports: [WorkshopsService, EnrollmentService],
})
export class WorkshopsModule {}
