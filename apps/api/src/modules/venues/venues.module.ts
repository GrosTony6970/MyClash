import { Module } from '@nestjs/common';
import { VenuesController } from './venues.controller';
import { VenuesService } from './venues.service';
import { OrganizationsModule } from '../organizations/organizations.module';
import { NotificationSchedulingModule } from '../notifications/notification-scheduling.module';

@Module({
  // NotificationSchedulingModule is the notification LEAF, never WorkersModule:
  // the leaf has no import edges that re-enter the graph, so reaching the alert
  // refresher through it cannot re-open the cycle it was cut to break.
  imports: [OrganizationsModule, NotificationSchedulingModule],
  controllers: [VenuesController],
  providers: [VenuesService],
  exports: [VenuesService],
})
export class VenuesModule {}
