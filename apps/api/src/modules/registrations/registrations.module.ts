import { Module } from '@nestjs/common';
import { RegistrationsController } from './registrations.controller';
import { RegistrationsService } from './registrations.service';
import { AssignmentsService } from './assignments.service';

@Module({
  controllers: [RegistrationsController],
  providers: [RegistrationsService, AssignmentsService],
  exports: [RegistrationsService, AssignmentsService],
})
export class RegistrationsModule {}
