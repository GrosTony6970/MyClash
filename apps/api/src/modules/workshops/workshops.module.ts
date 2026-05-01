import { Module } from '@nestjs/common';
import { EnrollmentService } from './enrollment.service';
import { WorkshopsController } from './workshops.controller';
import { WorkshopsService } from './workshops.service';

@Module({
  controllers: [WorkshopsController],
  providers: [WorkshopsService, EnrollmentService],
  exports: [WorkshopsService, EnrollmentService],
})
export class WorkshopsModule {}
