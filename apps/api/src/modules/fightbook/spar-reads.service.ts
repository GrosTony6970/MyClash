import { Injectable } from '@nestjs/common';
import { addDays } from '@myclash/time';
import type { IncomingSparRequest, MySpars, SparFighter } from '@myclash/types';
import { applyReachable } from '../fighters/directory-predicate';
import { SupabaseService } from '../supabase/supabase.service';
import { readSparFighters, unknownSparFighter } from './spar-fighters';
import { toAgreed, toIncoming, toSent, type SparRow } from './spar-views';

/** How far back My spars looks, in days, and how many rows each list holds (Decision 12). */
const LOOK_BACK_DAYS = 30;
const LIST_CAP = 200;

const byDayThenTime = (a: SparRow, b: SparRow) =>
  a.spar_day.localeCompare(b.spar_day) || (a.spar_time ?? '').localeCompare(b.spar_time ?? '');

/**
 * The Inbox and My spars (FightBook slice 1). Every read names the caller's profile in its filter:
 * nobody reads another fighter's requests. The other fighter on a card shows a name and a photo
 * only (a photo has no visibility switch); never the Event roster, never a profile link.
 */
@Injectable()
export class SparReadsService {
  constructor(private readonly supabase: SupabaseService) {}

  /**
   * Requests waiting for my answer, still open, soonest day first. Only those `fightbook_answer`
   * (0264) would take: the asker still live, claimed and on. A merge, a deleted profile or a late
   * switch can leave a request waiting from someone nobody may answer any more.
   */
  async inbox(me: string, now = new Date()): Promise<IncomingSparRequest[]> {
    const { data, error } = await this.supabase.service
      .from('spar_requests')
      .select(
        'id, asker_global_person_id, receiver_global_person_id, kind, event_id, spar_day, spar_time, place, weapons, message, status, expires_at, shared_comment, cancelled_by, cancel_message',
      )
      .eq('receiver_global_person_id', me)
      .eq('status', 'pending')
      .gt('expires_at', now.toISOString())
      .order('spar_day', { ascending: true })
      .limit(LIST_CAP);
    if (error) throw new Error(`FightBook inbox read failed: ${error.message}`);
    const waiting = (data ?? []) as SparRow[];
    const open = await this.answerableAskers(waiting.map((r) => r.asker_global_person_id));
    const rows = waiting.filter((r) => open.has(r.asker_global_person_id)).sort(byDayThenTime);
    const { fighters, events } = await this.cards(rows);
    return rows.map((row) =>
      toIncoming(row, fighters(row.asker_global_person_id), events(row.event_id)),
    );
  }

  /** My agreed and cancelled spars, both ways, then the requests I sent and their answer. */
  async mySpars(me: string, now = new Date()): Promise<MySpars> {
    const since = addDays(now.toISOString().slice(0, 10), -LOOK_BACK_DAYS) ?? '';
    const [asked, wasAsked, sent] = await Promise.all([
      this.sparsOf('asker_global_person_id', me, since),
      this.sparsOf('receiver_global_person_id', me, since),
      this.sentBy(me, since),
    ]);
    const spars = [...asked, ...wasAsked].sort(byDayThenTime);
    const { fighters, events } = await this.cards([...spars, ...sent]);
    const partner = (row: SparRow) =>
      row.asker_global_person_id === me
        ? row.receiver_global_person_id
        : row.asker_global_person_id;
    return {
      spars: spars.map((row) => toAgreed(row, me, fighters(partner(row)), events(row.event_id))),
      sent: sent.map((row) =>
        toSent(row, fighters(row.receiver_global_person_id), events(row.event_id), now),
      ),
    };
  }

  private async sparsOf(
    side: 'asker_global_person_id' | 'receiver_global_person_id',
    me: string,
    since: string,
  ): Promise<SparRow[]> {
    const { data, error } = await this.supabase.service
      .from('spar_requests')
      .select(
        'id, asker_global_person_id, receiver_global_person_id, kind, event_id, spar_day, spar_time, place, weapons, message, status, expires_at, shared_comment, cancelled_by, cancel_message',
      )
      .eq(side, me)
      .in('status', ['agreed', 'cancelled'])
      .gte('spar_day', since)
      .order('spar_day', { ascending: true })
      .limit(LIST_CAP);
    if (error) throw new Error(`FightBook spars read failed: ${error.message}`);
    return (data ?? []) as SparRow[];
  }

  /**
   * Withdrawn requests are not listed: the asker took them back. Looks back by the spar's DAY, as
   * `sparsOf` does, never by when it was asked: a request still waiting for a far day stays in
   * sight, or its asker meets "already asked" for a request they cannot see.
   */
  private async sentBy(me: string, since: string): Promise<SparRow[]> {
    const { data, error } = await this.supabase.service
      .from('spar_requests')
      .select(
        'id, asker_global_person_id, receiver_global_person_id, kind, event_id, spar_day, spar_time, place, weapons, message, status, expires_at, shared_comment, cancelled_by, cancel_message',
      )
      .eq('asker_global_person_id', me)
      .in('status', ['pending', 'not_this_time'])
      .gte('spar_day', since)
      .order('spar_day', { ascending: true })
      .limit(LIST_CAP);
    if (error) throw new Error(`FightBook sent requests read failed: ${error.message}`);
    return ((data ?? []) as SparRow[]).sort(byDayThenTime);
  }

  /** Of these askers, those still live, claimed and with FightBook on (as `fightbook_answer`). */
  private async answerableAskers(ids: string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const { data, error } = await applyReachable(
      this.supabase.service.from('global_persons').select('id'),
    )
      .in('id', [...new Set(ids)])
      .eq('fightbook_enabled', true)
      .not('claimed_by_user_id', 'is', null);
    if (error) throw new Error(`FightBook askers read failed: ${error.message}`);
    return new Set(((data ?? []) as Array<{ id: string }>).map((p) => p.id));
  }

  /** The fighters and Events the cards name, one read each. */
  private async cards(rows: SparRow[]) {
    const fighterIds = [
      ...new Set(rows.flatMap((r) => [r.asker_global_person_id, r.receiver_global_person_id])),
    ];
    const eventIds = [...new Set(rows.map((r) => r.event_id).filter((id): id is string => !!id))];
    const [people, eventNames] = await Promise.all([
      readSparFighters(this.supabase.service, fighterIds),
      this.eventNames(eventIds),
    ]);
    return {
      fighters: (id: string): SparFighter => people.get(id) ?? unknownSparFighter(id),
      events: (id: string | null) => (id ? (eventNames.get(id) ?? null) : null),
    };
  }

  private async eventNames(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const { data, error } = await this.supabase.service
      .from('events')
      .select('id, name')
      .in('id', ids);
    if (error) throw new Error(`FightBook Event names read failed: ${error.message}`);
    return new Map(
      ((data ?? []) as Array<{ id: string; name: string }>).map((e) => [e.id, e.name]),
    );
  }
}
