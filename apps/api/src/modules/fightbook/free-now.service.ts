import { Injectable } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { inListChunks } from '../../common/postgrest-in-list';
import { SupabaseService } from '../supabase/supabase.service';
import { floorEvent, offTheFloor } from './floor-event';
import { unreadable } from './log-reason';
import { sparExpiresAt } from './spar-ask-rules';

type Db = Pick<SupabaseClient, 'from'>;

/** "Free to spar now" lasts an hour, never past the end of the Event day. */
const FREE_NOW_MS = 60 * 60 * 1000;

/**
 * Which of these fighters are free to spar now at this Event (Find's Event block, ruling 708).
 * `ids` are fighters the caller already listed (live, claimed, FightBook on, on the roster):
 * this marks them, it does not list anyone. A row of another Event or past its `until` is not
 * free here. `atEvent` passes the whole askable roster (before its `AT_EVENT_MAX` cut, so the
 * free-now fighters sort first), so the ids are read in `IN_LIST_MAX` chunks, one read each.
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
    if (error) throw unreadable('the free-now marks are unreadable', error);
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
  if (error) throw unreadable('the free-now marks are unreadable', error);
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
    const { today, zone } = await floorEvent(db, me, eventId, now);
    if (!today) throw offTheFloor();
    const dayEnds = sparExpiresAt('event', today, zone);
    if (!dayEnds) throw new Error(`free-now: Event ${eventId} day ${today} has no readable end`);
    const until = new Date(Math.min(now.getTime() + FREE_NOW_MS, dayEnds.getTime()));
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
