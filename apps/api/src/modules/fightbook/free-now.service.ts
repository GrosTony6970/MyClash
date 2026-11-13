import { BadRequestException, Injectable } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { SparRefusalCode } from '@myclash/types';
import { isPublicEvent } from '../../common/auth/event-read-gate';
import { eventZone } from '../../common/event-clock';
import { inListChunks } from '../../common/postgrest-in-list';
import { SupabaseService } from '../supabase/supabase.service';
import { isOnEventRoster } from './spar-askable';
import { openEventDays, sparExpiresAt } from './spar-ask-rules';

type Db = Pick<SupabaseClient, 'from'>;

/** "Free to spar now" lasts an hour, never past the end of the Event day. */
const FREE_NOW_MS = 60 * 60 * 1000;

/**
 * Which of these fighters are free to spar now at this Event (Find's Event block, ruling 708).
 * `ids` are fighters the caller already listed (live, claimed, FightBook on, on the roster):
 * this marks them, it does not list anyone. A row of another Event or past its `until` is not
 * free here. At most `AT_EVENT_MAX` ids, so one read per `IN_LIST_MAX`.
 */
export async function freeAt(
  db: Db,
  eventId: string,
  ids: readonly string[],
  now: Date,
): Promise<Set<string>> {
  const free = new Set<string>();
  for (const piece of inListChunks(ids)) {
    const { data, error } = await db
      .from('fightbook_free_now')
      .select('global_person_id')
      .eq('event_id', eventId)
      .gt('until', now.toISOString())
      .in('global_person_id', piece);
    if (error) throw new Error(`FightBook free-now read failed: ${error.message}`);
    for (const row of (data ?? []) as Array<{ global_person_id: string }>) {
      free.add(row.global_person_id);
    }
  }
  return free;
}

/** The caller's own live free-now time, by Event id (at most one: one venue at a time). */
export async function ownFreeUntil(db: Db, me: string, now: Date): Promise<Map<string, string>> {
  const { data, error } = await db
    .from('fightbook_free_now')
    .select('event_id, until')
    .eq('global_person_id', me)
    .gt('until', now.toISOString());
  if (error) throw new Error(`FightBook free-now read failed: ${error.message}`);
  return new Map(
    ((data ?? []) as Array<{ event_id: string; until: string }>).map((row) => [
      row.event_id,
      new Date(row.until).toISOString(),
    ]),
  );
}

/** Switch "free to spar now" on or off at an Event (FightBook slice 5, Decisions 1 and 2). */
@Injectable()
export class FreeNowService {
  constructor(private readonly supabase: SupabaseService) {}

  /**
   * Free at this Event for an hour, or until its day ends if that comes first. One row per
   * profile, so switching on at another Event moves the fighter (the upsert is the only writer
   * of the row: two taps at once leave one row). 400 `bad_event` unless the Event is public, the
   * caller is on its roster and a day of it has started and not ended.
   */
  async switchOn(me: string, eventId: string, now = new Date()): Promise<{ until: string }> {
    const db = this.supabase.service;
    const { data, error } = await db
      .from('events')
      .select('id, status, organization_id, event_kind, start_date, end_date, timezone')
      .eq('id', eventId)
      .maybeSingle();
    if (error) throw new Error(`FightBook Event read failed: ${error.message}`);
    const event = data as {
      status: string;
      event_kind: string | null;
      start_date: string;
      end_date: string;
      timezone: unknown;
    } | null;
    const today = event && isPublicEvent(event) ? openEventDays(event, now).today : null;
    if (!event || !today || !(await isOnEventRoster(db, me, eventId))) {
      throw new BadRequestException({
        code: 'bad_event' satisfies SparRefusalCode,
        message: 'You can be free to spar at a public Event you are at, on a day it runs',
      });
    }
    const dayEnds = sparExpiresAt('event', today, eventZone(event.timezone).zone);
    const until = new Date(Math.min(now.getTime() + FREE_NOW_MS, dayEnds?.getTime() ?? Infinity));
    const { error: writeError } = await db
      .from('fightbook_free_now')
      .upsert(
        { global_person_id: me, event_id: eventId, until: until.toISOString() },
        { onConflict: 'global_person_id' },
      );
    if (writeError) throw new Error(`FightBook free-now write failed: ${writeError.message}`);
    return { until: until.toISOString() };
  }

  /** Not free any more at this Event. Quiet when the fighter was not (two taps are common). */
  async switchOff(me: string, eventId: string): Promise<void> {
    const { error } = await this.supabase.service
      .from('fightbook_free_now')
      .delete()
      .eq('global_person_id', me)
      .eq('event_id', eventId);
    if (error) throw new Error(`FightBook free-now delete failed: ${error.message}`);
  }
}
