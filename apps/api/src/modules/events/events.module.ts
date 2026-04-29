import { Module } from '@nestjs/common';
import { OrganizationsModule } from '../organizations/organizations.module';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';

@Module({
  imports: [OrganizationsModule],
  controllers: [EventsController],
  providers: [EventsService],
  exports: [EventsService],
})
export class EventsModule {}
