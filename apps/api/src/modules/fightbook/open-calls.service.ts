import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { zonedToUtcIso } from '@myclash/time';
import type { OpenCallsAtEvent } from '@myclash/types';
import { NotificationSchedulerService } from '../../workers/notification-scheduler.worker';
import { SupabaseService } from '../supabase/supabase.service';
import { floorEvent, offTheFloor, publicFloorEvent } from './floor-event';
import { callIsOpen, type OpenCallStatus } from './open-call-views';
import { readOpenCalls } from './open-call-reads';
import { badRequest, catalogWeapons, sparExpiresAt } from './spar-ask-rules';
import { blockedBy, fightBookOnFighters, isOnEventRoster } from './spar-askable';
import { notifySparCallAnswered, notifySparCallPicked, type SparNoticeDeps } from './spar-notices';
import { databaseRefusal } from './spar-requests.service';
import { notOpen } from './spar-side';

/**
 * At most this many OPEN calls per poster per Event day (Decision 6, ruling 710). The count and
 * the insert are two statements: two posts at the same instant can both see 4 and make 6.
 */
export const OPEN_CALLS_PER_DAY = 5;

/** A call, as the answer and take-back routes read it. */
interface CallGate {
  poster_global_person_id: string;
  event_id: string;
  status: OpenCallStatus;
  closes_at: string;
}

const notFound = () => new NotFoundException('Open call not found');

/**
 * When a call posted for `time` today closes: `today` + `time` on the Event's clock (Decision 5),
 * which must be later than now; else 400 `bad_time`. A day's wall times all fall before its end
 * (06:00 next morning), so a time past on `today` is the only one refused: on the morning after
 * the last day, today is still that last day and every time of it is past.
 */
function callClosesAt(today: string, time: string, zone: string, now: Date): Date {
  const iso = zonedToUtcIso(today, time, zone);
  const closes = iso ? new Date(iso) : null;
  if (!closes || closes.getTime() <= now.getTime()) {
    throw badRequest('bad_time', 'An open call is for a time later today');
  }
  return closes;
}

/**
 * Open calls at an Event (FightBook slice 5, Decisions 4-10): post one, close it, answer "I'm in"
 * or take it back, pick an answer. Every write acts on the caller's own profile. A stranger's
 * call answers 404, never 403. Whether the poster blocked the caller is never read here (ruling
 * 672): the pick refuses such a pair in SQL, and the "someone is in" notice reads it inside its
 * own un-awaited send.
 */
@Injectable()
export class OpenCallsService {
  private readonly logger = new Logger(OpenCallsService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly notifications: NotificationSchedulerService,
  ) {}

  /** Today's calls at an Event I am at (Decision 8); none on a day the Event does not run. */
  async read(me: string, eventId: string, now = new Date()): Promise<OpenCallsAtEvent> {
    const db = this.supabase.service;
    const { today } = await floorEvent(db, me, eventId, now);
    if (!today) return { mine: [], others: [] };
    return readOpenCalls(db, me, eventId, today, now);
  }

  /**
   * Post a call for today at an Event I am at. Checked before anything is written: the Event
   * (`bad_event`), the weapons (`bad_weapon`), the time (`bad_time`), the cap (`too_many_calls`).
   */
  async post(
    me: string,
    eventId: string,
    input: { weapons: string[]; time: string },
    now = new Date(),
  ): Promise<{ id: string }> {
    const db = this.supabase.service;
    const { today, zone } = await floorEvent(db, me, eventId, now);
    if (!today) throw offTheFloor();
    const weapons = await catalogWeapons(db, input.weapons);
    const closesAt = callClosesAt(today, input.time, zone, now);
    await this.belowTheCap(me, eventId, today, now);
    const { data, error } = await db
      .from('spar_open_calls')
      .insert({
        poster_global_person_id: me,
        event_id: eventId,
        spar_day: today,
        zone,
        spar_time: input.time,
        weapons,
        closes_at: closesAt.toISOString(),
      })
      .select('id')
      .single();
    if (error) throw new Error(`open call post failed: ${error.message}`);
    return { id: (data as { id: string }).id };
  }

  /**
   * Close my call while it is open: one conditional update. Already closed (a second tap): quiet.
   * Already picked: 409 `not_open` (the spar is cancelled in My spars). Not mine: 404.
   */
  async close(me: string, callId: string): Promise<void> {
    const db = this.supabase.service;
    const { data, error } = await db
      .from('spar_open_calls')
      .update({ status: 'closed' })
      .eq('id', callId)
      .eq('poster_global_person_id', me)
      .eq('status', 'open')
      .select('id');
    if (error) throw new Error(`open call close failed: ${error.message}`);
    if ((data ?? []).length > 0) return;
    const { data: row, error: readError } = await db
      .from('spar_open_calls')
      .select('status')
      .eq('id', callId)
      .eq('poster_global_person_id', me)
      .maybeSingle();
    if (readError) throw new Error(`open call read failed: ${readError.message}`);
    if (!row) throw notFound();
    if ((row as { status: OpenCallStatus }).status === 'picked') throw notOpen();
  }

  /**
   * "I'm in" on someone else's open call: one answer however many taps (Decision 7). 404 for a
   * call I cannot see (off its Event's roster included); 400 `self` on my own; 400 `bad_event`
   * once its Event is no longer public, as the read; 409 `not_open` once it closed or was picked.
   * The poster's notice is started, not awaited.
   */
  async answer(me: string, callId: string, now = new Date()): Promise<void> {
    const db = this.supabase.service;
    const call = await this.visibleCall(me, callId);
    if (call.poster_global_person_id === me) throw badRequest('self', 'This is your own call');
    if (!(await publicFloorEvent(db, call.event_id, now))) throw offTheFloor();
    if (!callIsOpen(call, now)) throw notOpen();
    const { error } = await db
      .from('spar_open_call_answers')
      .upsert(
        { call_id: callId, answerer_global_person_id: me },
        { onConflict: 'call_id,answerer_global_person_id', ignoreDuplicates: true },
      );
    if (error) throw new Error(`open call answer failed: ${error.message}`);
    void notifySparCallAnswered(this.noticeDeps(), callId, call.poster_global_person_id, me);
  }

  /**
   * Take back my "I'm in" while the call is open. 404 for a call I cannot see, off its Event's
   * roster included (Decision 7: only a fighter on that roster answers or takes back, and an off
   * fighter's 404 must equal an unknown call's); quiet if there is no answer. No public check: it
   * removes presence.
   */
  async takeBack(me: string, callId: string, now = new Date()): Promise<void> {
    const call = await this.visibleCall(me, callId);
    if (!callIsOpen(call, now)) throw notOpen();
    const { error } = await this.supabase.service
      .from('spar_open_call_answers')
      .delete()
      .eq('call_id', callId)
      .eq('answerer_global_person_id', me);
    if (error) throw new Error(`open call take-back failed: ${error.message}`);
  }

  /**
   * Pick one answer of my open call: one database call (`fightbook_call_pick`, 0270) agrees the
   * spar and answers its id, or refuses `not_open` (409): the call is no longer open, the answer
   * was taken back, or either fighter blocked the other or is off FightBook. Not mine: 404. An
   * Event no longer public: 400 `bad_event`, as the read. The fighter picked is told; nobody else.
   */
  async pick(
    me: string,
    callId: string,
    answerer: string,
    now = new Date(),
  ): Promise<{ requestId: string }> {
    const db = this.supabase.service;
    const { data: row, error: readError } = await db
      .from('spar_open_calls')
      .select('event_id, spar_day, zone')
      .eq('id', callId)
      .eq('poster_global_person_id', me)
      .maybeSingle();
    if (readError) throw new Error(`open call read failed: ${readError.message}`);
    if (!row) throw notFound();
    const call = row as { event_id: string; spar_day: string; zone: string };
    if (!(await publicFloorEvent(db, call.event_id, now))) throw offTheFloor();
    const expires = sparExpiresAt('event', call.spar_day, call.zone);
    if (!expires) throw new Error(`open call ${callId} has no readable day`);
    const { data, error } = await db.rpc('fightbook_call_pick', {
      p_call: callId,
      p_poster: me,
      p_answerer: answerer,
      p_expires_at: expires.toISOString(),
    });
    if (error) throw databaseRefusal(error, 'open call pick');
    const requestId = data as string;
    void notifySparCallPicked(this.noticeDeps(), requestId, answerer);
    return { requestId };
  }

  /** The deps the open-call notices use. */
  protected noticeDeps(): SparNoticeDeps {
    return {
      db: this.supabase.service,
      notifications: this.notifications,
      supabase: this.supabase,
      logger: this.logger,
    };
  }

  /**
   * A call the caller may see (Decisions 7 and 8), or 404 with the face of an unknown id: it
   * exists, the caller is on its Event's roster, its poster is on FightBook, and the caller did
   * not block its poster. Only the caller's own blocks are read.
   */
  private async visibleCall(me: string, callId: string): Promise<CallGate> {
    const db = this.supabase.service;
    const { data, error } = await db
      .from('spar_open_calls')
      .select('poster_global_person_id, event_id, status, closes_at')
      .eq('id', callId)
      .maybeSingle();
    if (error) throw new Error(`open call read failed: ${error.message}`);
    const call = data as CallGate | null;
    if (!call) throw notFound();
    const poster = call.poster_global_person_id;
    const [onRoster, blocked, on] = await Promise.all([
      isOnEventRoster(db, me, call.event_id),
      blockedBy(db, me),
      fightBookOnFighters(db, [poster]),
    ]);
    if (!onRoster || blocked.has(poster) || !on.has(poster)) throw notFound();
    return call;
  }

  /** 400 `too_many_calls` when I already have `OPEN_CALLS_PER_DAY` OPEN calls here today. */
  private async belowTheCap(me: string, eventId: string, today: string, now: Date): Promise<void> {
    const { data, error } = await this.supabase.service
      .from('spar_open_calls')
      .select('id')
      .eq('poster_global_person_id', me)
      .eq('event_id', eventId)
      .eq('spar_day', today)
      .eq('status', 'open')
      .gt('closes_at', now.toISOString())
      .limit(OPEN_CALLS_PER_DAY);
    if (error) throw new Error(`open calls count failed: ${error.message}`);
    if ((data ?? []).length >= OPEN_CALLS_PER_DAY) {
      throw badRequest('too_many_calls', 'Close an open call to post another');
    }
  }
}
