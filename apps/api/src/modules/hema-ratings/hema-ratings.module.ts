import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { HemaRatingsController } from './hema-ratings.controller';
import { HEMA_RATINGS_QUEUE_NAME, HemaRatingsService } from './hema-ratings.service';
import { OrganizationsModule } from '../organizations/organizations.module';

@Module({
  // Register the queue locally so `HemaRatingsService` can `@InjectQueue` it
  // (alongside the WorkersModule's processor registration). BullMQ deduplicates
  // by queue name at the Redis layer, so both registrations point at the same
  // physical queue; Nest gives each module its own injection token.
  // OrganizationsModule provides the org-role check the Event-scoped sync runs
  // through (`assertCanManageEvent`).
  imports: [BullModule.registerQueue({ name: HEMA_RATINGS_QUEUE_NAME }), OrganizationsModule],
  controllers: [HemaRatingsController],
  providers: [HemaRatingsService],
  exports: [HemaRatingsService],
})
export class HemaRatingsModule {}
