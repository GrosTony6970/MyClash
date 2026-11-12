import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  type HttpException,
} from '@nestjs/common';
import { addDays, isIanaZone } from '@myclash/time';
import type { SparKind, SparRefusalCode } from '@myclash/types';
import { isPublicEvent } from '../../common/auth/event-read-gate';
import { eventZone } from '../../common/event-clock';
import { NotificationSchedulerService } from '../../workers/notification-scheduler.worker';
import { SupabaseService } from '../supabase/supabase.service';
import { refusal } from './fightbook-caller';
import { SPAR_MAX_DAYS_AHEAD, eventDayRefusal, sparExpiresAt } from './spar-ask-rules';
import { isOnEventRoster } from './spar-askable';
import {
  notifySparAgreed,
  notifySparCancelled,
  notifySparRequestReceived,
  type SparNoticeDeps,
} from './spar-notices';

/** An ask, as the route's body carries it. */
export interface AskSparInput {
  receiverGlobalPersonId: string;
  kind: SparKind;
  eventId?: string;
  day: string;
  zone?: string;
  time?: string;
  place?: string;
  weapons: string[];
  message?: string;
}

/** An answer, as the route's body carries it. */
export interface SparAnswerInput {
  answer: 'yes' | 'no';
  comment?: string;
  showComment?: boolean;
}

interface Where {
  eventId: string | null;
  zone: string;
  place: string | null;
}

const notOpen = () =>
  new ConflictException({ code: 'not_open', message: 'This request is no longer open' });

const badRequest = (code: SparRefusalCode, message: string) =>
  new BadRequestException({ code, message });

/** A database refusal word (P0001) as the API answers it; anything else is a 5xx. */
export function databaseRefusal(error: { code?: string; message: string }, what: string): Error {
  if (error.code !== 'P0001') return new Error(`${what} failed: ${error.message}`);
  const word = error.message as SparRefusalCode;
  if (word === 'already_asked' || word === 'not_again' || word === 'not_open') {
    return new ConflictException({ code: word, message: word });
  }
  if (word === 'self' || word === 'bad_answer') return badRequest(word, word);
  return refusal(word, word) as HttpException;
}

/**
 * Asking for a spar, answering, withdrawing and cancelling (FightBook slice 1). The rules that must
 * win a race live in the database (`fightbook_ask`, `fightbook_answer`, 0264); this checks what
 * the request says about the day, the place and the weapons, and tells the other fighter.
 */
@Injectable()
export class SparRequestsService {
  private readonly logger = new Logger(SparRequestsService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly notifications: NotificationSchedulerService,
  ) {}

  /**
   * Store an ask, answer `{ id }`. A request to a fighter who blocked the asker is stored as an
   * ordinary "Not this time" and answered the same way, at the same speed: the "new request"
   * notice of a waiting ask is started and NOT awaited, so the blocked ask (which sends none) is
   * no faster (ruling 660 accepts that an instant no may still be guessed).
   */
  async ask(asker: string, input: AskSparInput, now = new Date()): Promise<{ id: string }> {
    const where =
      input.kind === 'event' ? await this.atEvent(asker, input) : this.onFreeDate(input);
    const expires = sparExpiresAt(input.kind, input.day, where.zone);
    const lastDay = addDays(now.toISOString().slice(0, 10), SPAR_MAX_DAYS_AHEAD);
    if (!expires || expires <= now || !lastDay || input.day > lastDay) {
      throw badRequest('bad_day', 'That day cannot be asked for');
    }
    const weapons = await this.catalogWeapons(input.weapons);

    const { data, error } = await this.supabase.service.rpc('fightbook_ask', {
      p_asker: asker,
      p_receiver: input.receiverGlobalPersonId,
      p_kind: input.kind,
      p_event_id: where.eventId,
      p_spar_day: input.day,
      p_zone: where.zone,
      p_spar_time: input.time ?? null,
      p_place: where.place,
      p_weapons: weapons,
      p_message: input.message ?? null,
      p_expires_at: expires.toISOString(),
    });
    if (error) throw databaseRefusal(error, 'spar ask');
    const stored = data as { id: string; status: 'pending' | 'not_this_time' };
    if (stored.status === 'pending') {
      void notifySparRequestReceived(this.noticeDeps(), stored.id, input.receiverGlobalPersonId);
    }
    return { id: stored.id };
  }

  /**
   * Yes or "Not this time", as the fighter asked (`me`, never a body value). One database call
   * (`fightbook_answer`): it lands only on my own request, still waiting and open, from an asker
   * still on FightBook; else 409 `not_open`. A yes tells the asker; a no tells nobody (663).
   */
  async answer(me: string, requestId: string, input: SparAnswerInput): Promise<{ status: string }> {
    const { data, error } = await this.supabase.service.rpc('fightbook_answer', {
      p_request: requestId,
      p_receiver: me,
      p_answer: input.answer,
      p_comment: input.comment ?? null,
      p_comment_shared: input.showComment === true,
    });
    if (error) throw databaseRefusal(error, 'spar answer');
    const answered = data as { asker: string; status: 'agreed' | 'not_this_time' };
    if (answered.status === 'agreed') {
      void notifySparAgreed(this.noticeDeps(), requestId, answered.asker);
    }
    return { status: answered.status };
  }

  /**
   * Take back my own request, still waiting and still open: one conditional update. A request
   * past its end is already a "no": withdrawing it would show the asker it ran out, and free them
   * from the no-asking-twice rule. Lost to an answer or to its end: 409 `not_open`. No notice.
   */
  async withdraw(me: string, requestId: string, now = new Date()): Promise<void> {
    const { data, error } = await this.supabase.service
      .from('spar_requests')
      .update({ status: 'withdrawn' })
      .eq('id', requestId)
      .eq('asker_global_person_id', me)
      .eq('status', 'pending')
      .gt('expires_at', now.toISOString())
      .select('id');
    if (error) throw new Error(`spar withdraw failed: ${error.message}`);
    if ((data ?? []).length === 0) throw notOpen();
  }

  /**
   * Cancel an agreed spar, either side, with an optional message; the other fighter is told.
   * A stranger gets 404, never 403 (a 403 would confirm the request exists). One conditional
   * update on the caller's own side: two cancels race to one winner, the loser gets `not_open`.
   * A spar is cancelled only until its day ends (`expires_at`, ruling 677): after that it is a spar
   * that happened or did not, and "We sparred" or silence is the answer.
   */
  async cancel(
    me: string,
    requestId: string,
    message: string | undefined,
    now = new Date(),
  ): Promise<void> {
    const { data, error } = await this.supabase.service
      .from('spar_requests')
      .select('id, asker_global_person_id, receiver_global_person_id, status')
      .eq('id', requestId)
      .maybeSingle();
    if (error) throw new Error(`spar read failed: ${error.message}`);
    const row = data as {
      asker_global_person_id: string;
      receiver_global_person_id: string;
    } | null;
    const side = row?.asker_global_person_id === me ? 'asker' : 'receiver';
    if (!row || (side === 'receiver' && row.receiver_global_person_id !== me)) {
      throw new NotFoundException('Spar not found');
    }
    const { data: won, error: writeError } = await this.supabase.service
      .from('spar_requests')
      .update({ status: 'cancelled', cancelled_by: side, cancel_message: message ?? null })
      .eq('id', requestId)
      .eq('status', 'agreed')
      .eq(`${side}_global_person_id`, me)
      .gt('expires_at', now.toISOString())
      .select('id');
    if (writeError) throw new Error(`spar cancel failed: ${writeError.message}`);
    if ((won ?? []).length === 0) throw notOpen();
    const other = side === 'asker' ? row.receiver_global_person_id : row.asker_global_person_id;
    void notifySparCancelled(this.noticeDeps(), requestId, other);
  }

  /** The deps every FightBook notice of this service uses. */
  protected noticeDeps(): SparNoticeDeps {
    return {
      db: this.supabase.service,
      notifications: this.notifications,
      supabase: this.supabase,
      logger: this.logger,
    };
  }

  /**
   * A published Event the asker is on (ruling 665): a draft or test Event could reveal a roster
   * nobody may see yet. The day is one of its days; the zone is its own.
   */
  private async atEvent(asker: string, input: AskSparInput): Promise<Where> {
    const eventId = input.eventId ?? '';
    const { data, error } = await this.supabase.service
      .from('events')
      .select('id, status, event_kind, start_date, end_date, timezone')
      .eq('id', eventId)
      .maybeSingle();
    if (error) throw new Error(`spar Event read failed: ${error.message}`);
    const event = data as {
      status: string;
      event_kind: string | null;
      start_date: string;
      end_date: string;
      timezone: string | null;
    } | null;
    if (
      !event ||
      !isPublicEvent(event) ||
      !(await isOnEventRoster(this.supabase.service, asker, eventId))
    ) {
      throw badRequest('bad_event', 'Spars can name only a public Event you are at');
    }
    if (eventDayRefusal(input.day, event)) {
      throw badRequest('bad_day', 'That day is not a day of the Event');
    }
    return { eventId, zone: eventZone(event.timezone).zone, place: null };
  }

  /** A free date: its place, and the asker's own clock. */
  private onFreeDate(input: AskSparInput): Where {
    if (!input.zone || !isIanaZone(input.zone)) {
      throw badRequest('bad_zone', 'A free date needs a time zone');
    }
    if (!input.place) throw badRequest('bad_place', 'A free date needs a place');
    return { eventId: null, zone: input.zone, place: input.place };
  }

  /** Each name as the active catalog spells it; one read for all (resolveCatalogWeapon's match). */
  private async catalogWeapons(names: string[]): Promise<string[]> {
    const { data, error } = await this.supabase.service
      .from('weapon_catalog')
      .select('name')
      .eq('active', true);
    if (error) throw new Error(`weapon catalog read failed: ${error.message}`);
    const catalog = (data ?? []) as Array<{ name: string }>;
    const resolved = names.map((name) => {
      const wanted = name.trim().toLowerCase();
      const match = catalog.find((w) => w.name.trim().toLowerCase() === wanted);
      if (!match) throw badRequest('bad_weapon', `Weapon "${name}" is not an active catalog entry`);
      return match.name;
    });
    return [...new Set(resolved)];
  }
}
