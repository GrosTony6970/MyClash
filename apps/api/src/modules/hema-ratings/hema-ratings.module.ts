import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { HemaRatingsController } from './hema-ratings.controller';
import { HEMA_RATINGS_QUEUE_NAME, HemaRatingsService } from './hema-ratings.service';

@Module({
  // Register the queue locally so `HemaRatingsService` can `@InjectQueue` it
  // (alongside the WorkersModule's processor registration). BullMQ deduplicates
  // by queue name at the Redis layer, so both registrations point at the same
  // physical queue; Nest gives each module its own injection token.
  imports: [BullModule.registerQueue({ name: HEMA_RATINGS_QUEUE_NAME })],
  controllers: [HemaRatingsController],
  providers: [HemaRatingsService],
  exports: [HemaRatingsService],
})
export class HemaRatingsModule {}
