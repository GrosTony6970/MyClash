import { Injectable, Logger } from '@nestjs/common';
import { dayStartUtcIso } from '@myclash/time';
import { NotificationSchedulerService } from '../../workers/notification-scheduler.worker';
import { SupabaseService } from '../supabase/supabase.service';
import { notOpen, readMySide } from './spar-side';
import { notifySparMarkedDone, type SparNoticeDeps } from './spar-notices';

const DAY_MS = 24 * 60 * 60 * 1000;
/** "We sparred" and its undo stay open this long after the spar day ends (rulings 680, 681). */
export const MARK_GRACE_MS = 2 * DAY_MS;

/** What a spar request's own columns say about when each after-the-spar action is open. */
export interface SparWindows {
  /** 00:00 of the spar day on the spar's own clock: "We sparred" opens. */
  markFrom: Date;
  /** Two days after the day ends: "We sparred" and its undo close; a review opens. */
  markUntil: Date;
  /** The day's end: a cancel closes. */
  cancelUntil: Date;
}

/** The windows, from the row alone, on the row's own `zone` (a free-date spar keeps its place's clock). */
export function sparWindows(row: {
  spar_day: string;
  zone: string;
  expires_at: string;
}): SparWindows {
  const ends = new Date(row.expires_at);
  const from = dayStartUtcIso(row.spar_day, row.zone, 0);
  return {
    markFrom: from ? new Date(from) : ends,
    markUntil: new Date(ends.getTime() + MARK_GRACE_MS),
    cancelUntil: ends,
  };
}

/**
 * After the spar (FightBook slice 3): "We sparred" and its undo. Each is one conditional update,
 * judged on the API's `now` (one clock), so a mark racing a cancel has one winner and the loser
 * gets 409 `not_open`; a spar is never both cancelled and done (the table's CHECK holds it too).
 */
@Injectable()
export class SparAfterService {
  private readonly logger = new Logger(SparAfterService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly notifications: NotificationSchedulerService,
  ) {}

  /**
   * Mark an agreed spar done, either fighter. Not before the spar day starts (checked here, on
   * the row's immutable day and zone), not after two days past its end (the update's `gt`). The
   * other fighter is told, started and not awaited.
   */
  async markDone(me: string, requestId: string, now = new Date()): Promise<void> {
    const { row, side, other } = await readMySide(this.supabase.service, me, requestId);
    if (now < sparWindows(row).markFrom) throw notOpen();
    await this.move(requestId, side, me, 'agreed', 'done', now);
    void notifySparMarkedDone(this.noticeDeps(), requestId, other);
  }

  /** Put a done spar back to agreed, either fighter, until two days past its end. No notice. */
  async undo(me: string, requestId: string, now = new Date()): Promise<void> {
    const { side } = await readMySide(this.supabase.service, me, requestId);
    await this.move(requestId, side, me, 'done', 'agreed', now);
  }

  private async move(
    requestId: string,
    side: 'asker' | 'receiver',
    me: string,
    from: 'agreed' | 'done',
    to: 'agreed' | 'done',
    now: Date,
  ): Promise<void> {
    const { data, error } = await this.supabase.service
      .from('spar_requests')
      .update({ status: to })
      .eq('id', requestId)
      .eq('status', from)
      .eq(`${side}_global_person_id`, me)
      .gt('expires_at', new Date(now.getTime() - MARK_GRACE_MS).toISOString())
      .select('id');
    if (error) throw new Error(`spar ${to} failed: ${error.message}`);
    if ((data ?? []).length === 0) throw notOpen();
  }

  private noticeDeps(): SparNoticeDeps {
    return {
      db: this.supabase.service,
      notifications: this.notifications,
      supabase: this.supabase,
      logger: this.logger,
    };
  }
}
