import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

/**
 * Server-initiated Supabase Realtime broadcasts.
 *
 * Table-level changes (exchanges INSERT/UPDATE, matches UPDATE, match_events
 * INSERT) are broadcast automatically via the supabase_realtime publication
 * set up in migration 0004_realtime.sql — this service is not involved in
 * those paths.
 *
 * This service handles derived/higher-level events that are not direct row
 * changes: standings recalculation results, high-level match lifecycle
 * notifications, etc. These are sent as Broadcast messages on named channels
 * using the service-role client (bypasses RLS — the server decides who to
 * notify at the application level).
 *
 * Used by: T-405 (live match view), T-1002 (standings overview).
 */
@Injectable()
export class RealtimeService {
  private readonly logger = new Logger(RealtimeService.name);

  constructor(private readonly supabase: SupabaseService) {}

  /**
   * Send a broadcast message to a named channel.
   *
   * @param channel  - Channel name (use Channels.* helpers)
   * @param event    - Event type string (e.g. 'standings_update', 'match_started')
   * @param payload  - Arbitrary JSON payload
   */
  async broadcast<T extends Record<string, unknown>>(
    channel: string,
    event: string,
    payload: T,
  ): Promise<void> {
    const result = await this.supabase.service.channel(channel).send({
      type: 'broadcast',
      event,
      payload,
    });

    if (result !== 'ok') {
      this.logger.warn(`Broadcast failed on channel "${channel}" event "${event}": ${result}`);
    }
  }
}
