import { Injectable, Logger } from '@nestjs/common';
import { dayStartUtcIso } from '@myclash/time';
import { NotificationSchedulerService } from '../../workers/notification-scheduler.worker';
import { SupabaseService } from '../supabase/supabase.service';
import { notOpen, readMySide } from './spar-side';
import { notifySparMarkedDone, type SparNoticeDeps } from './spar-notices';
import { databaseRefusal } from './spar-requests.service';

/** A thank-you or an anonymous review, as the route's body carries it (validated there). */
export interface SparReviewInput {
  stars: number;
  text?: string;
  anonymous: boolean;
}

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

  /**
   * A signed thank-you, or an anonymous review (stars only: its text is never sent), on a done
   * spar from two days after its end (rulings 683, 690). One database call, judged on the API's
   * `now`: `fightbook_review` (0267) checks the side, the status, the window and the one review
   * per writer, and answers `not_open` for each, a stranger included (it says nothing of whether
   * the spar exists).
   */
  async review(
    me: string,
    requestId: string,
    input: SparReviewInput,
    now = new Date(),
  ): Promise<void> {
    const { error } = await this.supabase.service.rpc('fightbook_review', {
      p_request: requestId,
      p_author: me,
      p_stars: input.stars,
      p_body: input.anonymous ? null : (input.text ?? null),
      p_anonymous: input.anonymous,
      p_now: now.toISOString(),
    });
    if (error) throw databaseRefusal(error, 'spar review');
  }

  /**
   * Write, replace or (null) delete the caller's private note on a done spar; only its writer
   * reads it. One note per (spar, writer), so the write is an upsert on that pair. The status is
   * read first: an undo landing between that read and the write leaves the note on an agreed spar,
   * still its writer's only. The table also keeps a decliner's private "Not this time" comment,
   * which this never touches: a declined request is never done.
   */
  async setNote(me: string, requestId: string, body: string | null): Promise<void> {
    const { row } = await readMySide(this.supabase.service, me, requestId);
    if (row.status !== 'done') throw notOpen();
    const db = this.supabase.service;
    const { error } =
      body === null
        ? await db
            .from('spar_private_notes')
            .delete()
            .eq('spar_request_id', requestId)
            .eq('author_global_person_id', me)
        : await db
            .from('spar_private_notes')
            .upsert(
              { spar_request_id: requestId, author_global_person_id: me, body },
              { onConflict: 'spar_request_id,author_global_person_id' },
            );
    if (error) throw new Error(`spar note failed: ${error.message}`);
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
