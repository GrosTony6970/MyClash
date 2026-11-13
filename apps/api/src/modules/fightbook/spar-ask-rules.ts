import { BadRequestException } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { addDays, dayStartUtcIso, isIanaZone } from '@myclash/time';
import type { SparKind, SparRefusalCode } from '@myclash/types';
import { eventZone } from '../../common/event-clock';
import { EVENT_CLOSING_HOUR } from '../../common/event-open-window';

/** How far ahead a spar may be asked for. */
export const SPAR_MAX_DAYS_AHEAD = 365;

/** A FightBook refusal of what the request says: 400 with its `code`. */
export const badRequest = (code: SparRefusalCode, message: string) =>
  new BadRequestException({ code, message });

/** Where a spar happens: an Event (its own zone), or a free date's place and zone. */
export interface SparWhere {
  eventId: string | null;
  zone: string;
  place: string | null;
}

/** A free date: its place, and the asker's own clock. 400 `bad_zone` / `bad_place`. */
export function onFreeDate(input: { zone?: string; place?: string }): SparWhere {
  if (!input.zone || !isIanaZone(input.zone)) {
    throw badRequest('bad_zone', 'A free date needs a time zone');
  }
  if (!input.place) throw badRequest('bad_place', 'A free date needs a place');
  return { eventId: null, zone: input.zone, place: input.place };
}

/**
 * Each name as the active catalog spells it; one read for all (resolveCatalogWeapon's match).
 * 400 `bad_weapon` for a name the active catalog does not hold. The one owner for an ask, an
 * open call and a scan.
 */
export async function catalogWeapons(
  db: Pick<SupabaseClient, 'from'>,
  names: string[],
): Promise<string[]> {
  const { data, error } = await db.from('weapon_catalog').select('name').eq('active', true);
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

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/**
 * When a request for `day` ends unanswered: an Event day at 06:00 the next morning on the Event's
 * clock (ruling 154, the hour an Event day closes everywhere in MyClash), a free date at midnight
 * on the asker's clock. Null when `day` is not a date.
 */
export function sparExpiresAt(kind: SparKind, day: string, zone: string): Date | null {
  const nextDay = YMD.test(day) ? addDays(day, 1) : null;
  if (!nextDay) return null;
  const iso = dayStartUtcIso(nextDay, zone, kind === 'event' ? EVENT_CLOSING_HOUR : 0);
  return iso ? new Date(iso) : null;
}

/** The walk lists at most this many days from its start; it also stops here on a wrong end date. */
const MAX_EVENT_DAYS = 31;

/**
 * The days of an Event that have not ended on its own clock (a day ends at 06:00 the next
 * morning, as `sparExpiresAt`), and `today`: the latest open day whose midnight has passed, null
 * before the first day starts. Between 00:00 and 06:00 two days are open and started: the later
 * one is today. An unknown zone reads in the default one (`eventZone`).
 */
export function openEventDays(
  event: { start_date: string; end_date: string; timezone: unknown },
  now: Date,
): { days: string[]; today: string | null } {
  const { zone } = eventZone(event.timezone);
  const last = event.end_date.slice(0, 10);
  const days: string[] = [];
  let today: string | null = null;
  // A day older than yesterday (UTC) has ended in every zone, so a long Event walks from there.
  const yesterday = addDays(now.toISOString().slice(0, 10), -1);
  const first = event.start_date.slice(0, 10);
  let day = addDays(yesterday && yesterday > first ? yesterday : first, 0);
  for (let n = 0; day && day <= last && n < MAX_EVENT_DAYS; n++) {
    const ends = sparExpiresAt('event', day, zone);
    const starts = dayStartUtcIso(day, zone);
    if (ends && ends.getTime() > now.getTime()) {
      days.push(day);
      if (starts && new Date(starts).getTime() <= now.getTime()) today = day;
    }
    day = addDays(day, 1);
  }
  return { days, today };
}

/** 'bad_day' unless `day` is a date between the Event's first and last day. */
export function eventDayRefusal(
  day: string,
  event: { start_date: string; end_date: string },
): 'bad_day' | null {
  if (!YMD.test(day)) return 'bad_day';
  return day >= event.start_date.slice(0, 10) && day <= event.end_date.slice(0, 10)
    ? null
    : 'bad_day';
}
