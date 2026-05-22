import { Module } from '@nestjs/common';
import { MatchesModule } from '../matches/matches.module';
import { EventsModule } from '../events/events.module';
import { AdminRulesetsService } from './admin-rulesets.service';
import { ExchangeEditRequestsAdminService } from './exchange-edit-requests.service';
import { SuperAdminGuard } from './guards/super-admin.guard';
import { ReviewQueueController } from './review-queue.controller';
import { ReviewQueueService } from './review-queue.service';

@Module({
  imports: [MatchesModule, EventsModule],
  controllers: [ReviewQueueController],
  providers: [
    ReviewQueueService,
    AdminRulesetsService,
    ExchangeEditRequestsAdminService,
    SuperAdminGuard,
  ],
})
export class ReviewQueueModule {}
