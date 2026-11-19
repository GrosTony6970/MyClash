import { Module } from '@nestjs/common';
import { NotificationSchedulingModule } from '../notifications/notification-scheduling.module';
import { TournamentCompletionService } from './tournament-completion.service';

/**
 * A leaf: it imports only the notification scheduling leaf (SupabaseModule is global), so the
 * phases side (a bout ends), the events side (an organiser completes an Event) and the status
 * ticker can all import it without closing a cycle.
 */
@Module({
  imports: [NotificationSchedulingModule],
  providers: [TournamentCompletionService],
  exports: [TournamentCompletionService],
})
export class TournamentCompletionModule {}
