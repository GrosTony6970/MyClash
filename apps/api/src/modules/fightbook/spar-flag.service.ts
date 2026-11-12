import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { SparFlagReason } from '@myclash/types';
import { NotificationSchedulerService } from '../../workers/notification-scheduler.worker';
import { SupabaseService } from '../supabase/supabase.service';
import { notifySparFlagRaised } from './spar-flag-notice';
import { notOpen, readMySide } from './spar-side';
import { databaseRefusal } from './spar-requests.service';
import { sparWindows } from './spar-windows';

/** The spar statuses a safety flag can be sent on (rulings 691, 697). */
const FLAGGABLE = new Set(['agreed', 'done', 'cancelled']);

/**
 * A safety flag on a spar (FightBook slice 4, rulings 691, 693, 697). The window opens with
 * "We sparred" (`sparWindows(row).markFrom`, checked here on the row's immutable day and zone);
 * the web offers the form while the spar shows in My spars. The status, both profiles and the one
 * flag per reporter-family per spar are `fightbook_flag`'s (0269), under its locks.
 *
 * The race it names: two taps on Send. The first writes the flag and starts the alert; the second
 * gets `null` from the function and answers 204 without a second alert.
 */
@Injectable()
export class SparFlagService {
  private readonly logger = new Logger(SparFlagService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly notifications: NotificationSchedulerService,
    private readonly config: ConfigService,
  ) {}

  async raise(
    me: string,
    requestId: string,
    input: { reason: SparFlagReason; text: string },
    now = new Date(),
  ): Promise<void> {
    const db = this.supabase.service;
    const { row } = await readMySide(db, me, requestId);
    if (!FLAGGABLE.has(row.status) || now < sparWindows(row).markFrom) throw notOpen();
    const { data, error } = await db.rpc('fightbook_flag', {
      p_request: requestId,
      p_reporter: me,
      p_reason: input.reason,
      p_body: input.text,
      p_now: now.toISOString(),
    });
    if (error) throw databaseRefusal(error, 'spar flag');
    // Started, not awaited: a slow or failing send must not delay the answer, and the flag is saved.
    if (typeof data === 'string') void notifySparFlagRaised(this.noticeDeps(), data);
  }

  private noticeDeps() {
    return {
      db: this.supabase.service,
      notifications: this.notifications,
      supabase: this.supabase,
      logger: this.logger,
      domain: this.config.get<string>('DOMAIN', 'myclash.localhost'),
    };
  }
}
