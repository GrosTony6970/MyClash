import { Module } from '@nestjs/common';
import { RegistrationsController } from './registrations.controller';
import { RegistrationsService } from './registrations.service';
import { AssignmentsService } from './assignments.service';
import { IdentityModule } from '../identity/identity.module';

@Module({
  imports: [IdentityModule],
  controllers: [RegistrationsController],
  providers: [RegistrationsService, AssignmentsService],
  exports: [RegistrationsService, AssignmentsService],
})
export class RegistrationsModule {}
