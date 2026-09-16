import { Module } from '@nestjs/common';
import { NotificationSchedulingModule } from '../notifications/notification-scheduling.module';
import { MatchPlacementService } from './match-placement.service';

/**
 * A leaf module so every door that places a Match can inject the one owner.
 *
 * Four of them live in three different modules — matches, phases and the
 * organiser assistant — and a shared provider declared in any one of those
 * would close a cycle through the others. This imports only the alert refresher
 * it needs and exports only the service.
 */
@Module({
  imports: [NotificationSchedulingModule],
  providers: [MatchPlacementService],
  exports: [MatchPlacementService],
})
export class MatchPlacementModule {}
