import { Module } from '@nestjs/common';
import { WorkersModule } from '../../workers/workers.module';
import { EnrollmentService } from './enrollment.service';
import { WorkshopsController } from './workshops.controller';
import { WorkshopsService } from './workshops.service';

@Module({
  imports: [WorkersModule],
  controllers: [WorkshopsController],
  providers: [WorkshopsService, EnrollmentService],
  exports: [WorkshopsService, EnrollmentService],
})
export class WorkshopsModule {}
