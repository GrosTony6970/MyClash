import { Module } from '@nestjs/common';
import { WorkersModule } from '../../workers/workers.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { PersonsModule } from '../persons/persons.module';
import { EnrollmentService } from './enrollment.service';
import { FeedbackService } from './feedback.service';
import { WorkshopsController } from './workshops.controller';
import { WorkshopsService } from './workshops.service';

@Module({
  imports: [WorkersModule, NotificationsModule, OrganizationsModule, PersonsModule],
  controllers: [WorkshopsController],
  providers: [WorkshopsService, EnrollmentService, FeedbackService],
  exports: [WorkshopsService, EnrollmentService, FeedbackService],
})
export class WorkshopsModule {}
