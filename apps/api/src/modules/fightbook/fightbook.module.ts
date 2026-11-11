import { Module } from '@nestjs/common';
import { NotificationSchedulingModule } from '../notifications/notification-scheduling.module';
import { FightBookController } from './fightbook.controller';
import { FightBookSettingsService } from './fightbook-settings.service';
import { SparRequestsService } from './spar-requests.service';

/**
 * FightBook (slice 1). NotificationSchedulingModule is a leaf (it imports only its own queue), so
 * this edge cannot close a module cycle (module-graph.test.ts).
 */
@Module({
  imports: [NotificationSchedulingModule],
  controllers: [FightBookController],
  providers: [FightBookSettingsService, SparRequestsService],
})
export class FightBookModule {}
