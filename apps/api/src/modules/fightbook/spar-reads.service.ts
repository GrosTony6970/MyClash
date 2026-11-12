import { Injectable } from '@nestjs/common';
import { addDays } from '@myclash/time';
import type { IncomingSparRequest, MySpars, SparFighter } from '@myclash/types';
import { SupabaseService } from '../supabase/supabase.service';
import { askableFighters, favouritesOf, fightBookOnFighters } from './spar-askable';
import { readSparEventNames, readSparFighters, unknownSparFighter } from './spar-fighters';
import { SparThanksService } from './spar-thanks.service';
import { NO_EXTRAS, toAgreed, toIncoming, toSent, type SparRow } from './spar-views';

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
  constructor(
    private readonly supabase: SupabaseService,
    private readonly thanks: SparThanksService,
  ) {}

  /**
   * Requests waiting for my answer, still open, soonest day first. Only those `fightbook_answer`
   * (0264) would take: the asker still live, claimed and on. A merge, a deleted profile or a late
   * switch can leave a request waiting from someone nobody may answer any more.
   */
  async inbox(me: string, now = new Date()): Promise<IncomingSparRequest[]> {
    const { data, error } = await this.supabase.service
      .from('spar_requests')
      .select(
        'id, asker_global_person_id, receiver_global_person_id, kind, event_id, spar_day, zone, spar_time, place, weapons, message, status, expires_at, shared_comment, cancelled_by, cancel_message',
      )
      .eq('receiver_global_person_id', me)
      .eq('status', 'pending')
      .gt('expires_at', now.toISOString())
      .order('spar_day', { ascending: true })
      .limit(LIST_CAP);
    if (error) throw new Error(`FightBook inbox read failed: ${error.message}`);
    const waiting = (data ?? []) as SparRow[];
    const open = await fightBookOnFighters(
      this.supabase.service,
      waiting.map((r) => r.asker_global_person_id),
    );
    const rows = waiting.filter((r) => open.has(r.asker_global_person_id)).sort(byDayThenTime);
    const { fighters, events } = await this.cards(rows);
    return rows.map((row) =>
      toIncoming(row, fighters(row.asker_global_person_id), events(row.event_id)),
    );
  }

  /**
   * My agreed, cancelled and done spars, both ways, each with what was written on it, then the
   * requests I sent and their answer.
   */
  async mySpars(me: string, enabled: boolean, now = new Date()): Promise<MySpars> {
    const since = addDays(now.toISOString().slice(0, 10), -LOOK_BACK_DAYS) ?? '';
    const [asked, wasAsked, sent] = await Promise.all([
      this.sparsOf('asker_global_person_id', me, since),
      this.sparsOf('receiver_global_person_id', me, since),
      this.sentBy(me, since),
    ]);
    const spars = [...asked, ...wasAsked].sort(byDayThenTime);
    const partner = (row: SparRow) =>
      row.asker_global_person_id === me
        ? row.receiver_global_person_id
        : row.asker_global_person_id;
    const [{ fighters, events }, extras, hearts] = await Promise.all([
      this.cards([...spars, ...sent]),
      this.thanks.cardExtras(
        me,
        spars.map((row) => row.id),
      ),
      this.hearts(me, enabled, spars.map(partner)),
    ]);
    const card = (row: SparRow) =>
      toAgreed(
        row,
        me,
        fighters(partner(row)),
        events(row.event_id),
        extras.get(row.id) ?? NO_EXTRAS,
        hearts(partner(row)),
      );
    return {
      spars: spars.map(card),
      sent: sent.map((row) =>
        toSent(row, fighters(row.receiver_global_person_id), events(row.event_id), now),
      ),
    };
  }

  /**
   * Is each partner in my favourites? Null (no heart) when I have FightBook off, or the partner
   * is not someone I may ask (off, gone or blocked by me). Two reads, none when off.
   */
  private async hearts(
    me: string,
    enabled: boolean,
    partners: string[],
  ): Promise<(partner: string) => boolean | null> {
    if (!enabled || partners.length === 0) return () => null;
    const db = this.supabase.service;
    const [askable, favourites] = await Promise.all([
      askableFighters(db, me, partners),
      favouritesOf(db, me),
    ]);
    return (partner) => (askable.has(partner) ? favourites.has(partner) : null);
  }

  private async sparsOf(
    side: 'asker_global_person_id' | 'receiver_global_person_id',
    me: string,
    since: string,
  ): Promise<SparRow[]> {
    const { data, error } = await this.supabase.service
      .from('spar_requests')
      .select(
        'id, asker_global_person_id, receiver_global_person_id, kind, event_id, spar_day, zone, spar_time, place, weapons, message, status, expires_at, shared_comment, cancelled_by, cancel_message',
      )
      .eq(side, me)
      .in('status', ['agreed', 'cancelled', 'done'])
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
        'id, asker_global_person_id, receiver_global_person_id, kind, event_id, spar_day, zone, spar_time, place, weapons, message, status, expires_at, shared_comment, cancelled_by, cancel_message',
      )
      .eq('asker_global_person_id', me)
      .in('status', ['pending', 'not_this_time'])
      .gte('spar_day', since)
      .order('spar_day', { ascending: true })
      .limit(LIST_CAP);
    if (error) throw new Error(`FightBook sent requests read failed: ${error.message}`);
    return ((data ?? []) as SparRow[]).sort(byDayThenTime);
  }

  /** The fighters and Events the cards name, one read each. */
  private async cards(rows: SparRow[]) {
    const fighterIds = [
      ...new Set(rows.flatMap((r) => [r.asker_global_person_id, r.receiver_global_person_id])),
    ];
    const eventIds = [...new Set(rows.map((r) => r.event_id).filter((id): id is string => !!id))];
    const [people, eventNames] = await Promise.all([
      readSparFighters(this.supabase.service, fighterIds),
      readSparEventNames(this.supabase.service, eventIds),
    ]);
    return {
      fighters: (id: string): SparFighter => people.get(id) ?? unknownSparFighter(id),
      events: (id: string | null) => (id ? (eventNames.get(id) ?? null) : null),
    };
  }
}
