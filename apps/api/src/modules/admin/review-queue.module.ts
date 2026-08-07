import { Module } from '@nestjs/common';
import { MatchesModule } from '../matches/matches.module';
import { EventsModule } from '../events/events.module';
import { LeaguesModule } from '../leagues/leagues.module';
import { ExchangeEditRequestsAdminService } from './exchange-edit-requests.service';
import { PlatformRoleGuard } from './guards/platform-role.guard';
import { NotificationsSummaryController } from './notifications-summary.controller';
import { NotificationsSummaryService } from './notifications-summary.service';
import { ReviewQueueController } from './review-queue.controller';
import { ReviewQueueService } from './review-queue.service';

@Module({
  imports: [MatchesModule, EventsModule, LeaguesModule],
  controllers: [ReviewQueueController, NotificationsSummaryController],
  providers: [
    ReviewQueueService,
    NotificationsSummaryService,
    ExchangeEditRequestsAdminService,
    PlatformRoleGuard,
  ],
})
export class ReviewQueueModule {}
