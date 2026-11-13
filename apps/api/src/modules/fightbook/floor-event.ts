import type { SupabaseClient } from '@supabase/supabase-js';
import { isPublicEvent } from '../../common/auth/event-read-gate';
import { eventZone } from '../../common/event-clock';
import { badRequest, openEventDays } from './spar-ask-rules';
import { isOnEventRoster } from './spar-askable';

type Db = Pick<SupabaseClient, 'from'>;

/** An Event the floor tools work at: its day `today` (null when none is open and started) and zone. */
export interface FloorEvent {
  today: string | null;
  zone: string;
}

/** 400 `bad_event`: free-now and open calls live at a public Event the caller is on, on a day it runs. */
export const offTheFloor = () =>
  badRequest('bad_event', 'This works at a public Event you are at, on a day it runs');

/**
 * The floor tools' gate (FightBook slice 5, Decisions 2 and 8): a public Event (not a draft, not a
 * test) with the caller on its roster, else 400 `bad_event`. Answers its `today` on its own clock
 * (`openEventDays`) and its zone; a write that needs a day refuses a null `today` itself. The one
 * owner for free-now and open calls.
 */
export async function floorEvent(
  db: Db,
  me: string,
  eventId: string,
  now: Date,
): Promise<FloorEvent> {
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
  if (!event || !isPublicEvent(event) || !(await isOnEventRoster(db, me, eventId))) {
    throw offTheFloor();
  }
  return { today: openEventDays(event, now).today, zone: eventZone(event.timezone).zone };
}
