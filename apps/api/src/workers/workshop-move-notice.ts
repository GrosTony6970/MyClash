/**
 * workshop-move-notice.ts — the "session moved" notice of a Workshop (operator ruling, 2026-11-09).
 *
 * An organiser moves a session on the board, often a few times before it settles. The people
 * booked are told ONCE, about ten minutes after the last move, where it now runs; nothing is sent
 * when it ends up where it was. So the queue holds one job per account, replaced at each move
 * (`NotificationSchedulerService.scheduleWorkshopMoved`), and the job carries where the session
 * was before the FIRST move (`movedFrom`).
 *
 * The text is read again when the job fires (`asItStands`): a move whose own re-queue failed, or
 * two moves queued out of order, must not send a place the session has left. A leaf: the worker
 * and its scheduler both read it, and it reads neither.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { formatDateTime } from '@myclash/time';
import { eventZone } from '../common/event-clock';
import {
  workshopMoved,
  type NoticeEmailText,
} from '../modules/notifications/notice-texts/notice-texts';

/** How long after the last move the notice goes. */
export const WORKSHOP_MOVE_SETTLE_MS = 10 * 60_000;

/** When and where a session runs: what a move changes. */
export interface SessionPlace {
  startsAt: string | null;
  endsAt: string | null;
  venueId: string | null;
  areaId: string | null;
}

/** The columns a `SessionPlace` is read from. */
export const SESSION_PLACE_COLUMNS = 'starts_at, ends_at, venue_id, area_id';

export function placeOf(row: {
  starts_at?: string | null;
  ends_at?: string | null;
  venue_id?: string | null;
  area_id?: string | null;
}): SessionPlace {
  return {
    startsAt: row.starts_at ?? null,
    endsAt: row.ends_at ?? null,
    venueId: row.venue_id ?? null,
    areaId: row.area_id ?? null,
  };
}

/** One instant, however it is written: the database answers `+00:00`, a request sends `Z`. */
const sameInstant = (a: string | null, b: string | null): boolean =>
  a === null || b === null ? a === b : new Date(a).getTime() === new Date(b).getTime();

export function samePlace(a: SessionPlace, b: SessionPlace): boolean {
  return (
    sameInstant(a.startsAt, b.startsAt) &&
    sameInstant(a.endsAt, b.endsAt) &&
    a.venueId === b.venueId &&
    a.areaId === b.areaId
  );
}

const WHEN: Intl.DateTimeFormatOptions = {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
};

type One<T> = T | T[] | null | undefined;
const one = <T>(value: One<T>): T | null =>
  (Array.isArray(value) ? (value[0] ?? null) : (value ?? null)) as T | null;

interface MovedSessionRow {
  starts_at: string | null;
  ends_at: string | null;
  venue_id: string | null;
  area_id: string | null;
  location_label: string | null;
  workshops?: One<{ title?: string | null; events?: One<{ timezone?: string | null }> }>;
  venues?: One<{ name?: string | null }>;
  venue_areas?: One<{ name?: string | null }>;
}

/**
 * The session as it stands, with the notice that says it: its start on the Event's clock and its
 * room. Null when the session is gone. A read that fails throws: no notice is better than a wrong
 * one.
 */
export async function readMovedSession(
  db: SupabaseClient,
  sessionId: string,
): Promise<{ place: SessionPlace; text: NoticeEmailText } | null> {
  const { data, error } = await db
    .from('workshop_sessions')
    .select(
      `${SESSION_PLACE_COLUMNS}, location_label, workshops ( title, events ( timezone ) ), venues ( name ), venue_areas ( name )`,
    )
    .eq('id', sessionId)
    .maybeSingle();
  if (error) throw new Error(`Moved session ${sessionId} unreadable: ${error.message}`);
  if (!data) return null;
  const row = data as MovedSessionRow;
  const workshop = one(row.workshops);
  const { zone } = eventZone(one(workshop?.events)?.timezone);
  const when = row.starts_at
    ? {
        fr: formatDateTime(row.starts_at, 'fr', WHEN, zone),
        en: formatDateTime(row.starts_at, 'en', WHEN, zone),
      }
    : null;
  const room = [one(row.venues)?.name, one(row.venue_areas)?.name].filter(Boolean).join(' · ');
  return {
    place: placeOf(row),
    text: workshopMoved(workshop?.title, when, room || row.location_label || null),
  };
}

/**
 * The notice to send now, as the session stands, or null when it is not to go: the session is
 * gone, or it is back where it was before the first move.
 */
export async function asItStands(
  db: SupabaseClient,
  sessionId: string,
  movedFrom: SessionPlace | null | undefined,
): Promise<NoticeEmailText | null> {
  const moved = await readMovedSession(db, sessionId);
  if (!moved || !movedFrom || samePlace(moved.place, movedFrom)) return null;
  return moved.text;
}
