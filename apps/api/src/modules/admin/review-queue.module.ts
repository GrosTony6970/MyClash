import { Module } from '@nestjs/common';
import { FrozenResultsModule } from '../matches/frozen-results.module';
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
  // ExchangeEditRequestsAdminService is registered here AND in AdminModule, and
  // it injects FrozenResultsGuard non-optionally, so both registrations need the
  // leaf that provides it. Nest resolves per registering module, not per class.
  imports: [MatchesModule, FrozenResultsModule, EventsModule, LeaguesModule],
  controllers: [ReviewQueueController, NotificationsSummaryController],
  providers: [
    ReviewQueueService,
    NotificationsSummaryService,
    ExchangeEditRequestsAdminService,
    PlatformRoleGuard,
  ],
})
export class ReviewQueueModule {}
