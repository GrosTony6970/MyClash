import { Module } from '@nestjs/common';
import { WorkersModule } from '../../workers/workers.module';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { PersonsModule } from '../persons/persons.module';
import { EnrollmentService } from './enrollment.service';
import { FeedbackService } from './feedback.service';
import { WorkshopInstructorDetailsController } from './workshop-instructor-details.controller';
import { WorkshopInstructorDetailsService } from './workshop-instructor-details.service';
import { WorkshopsController } from './workshops.controller';
import { WorkshopsService } from './workshops.service';

@Module({
  imports: [WorkersModule, AuthModule, NotificationsModule, OrganizationsModule, PersonsModule],
  controllers: [WorkshopsController, WorkshopInstructorDetailsController],
  providers: [
    WorkshopsService,
    EnrollmentService,
    FeedbackService,
    WorkshopInstructorDetailsService,
  ],
  exports: [WorkshopsService, EnrollmentService, FeedbackService],
})
export class WorkshopsModule {}
