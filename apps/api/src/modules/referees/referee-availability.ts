/**
 * referee-availability.ts — a referee's declared availability: the one reader and the one writer
 * of `event_referee_tournaments` and `event_referee_days` (ADR-019, rulings 145-147, 149).
 *
 * The organiser ticks Tournaments and days on the roster, and the rows ARE the declaration: no
 * row on an axis = available always, for a Tournament or a day added later (ruling 145). A day
 * row names a calendar date on the Event's clock (ruling 147) and may carry one from–to window in
 * minutes into that day (ruling 146; 1440 = the next midnight).
 *
 * The board (`AssignmentBoardService`) and the roster (`QualificationsService`) both read here,
 * so they cannot disagree. The checker and the capacity warning judge with `isAvailableFor`
 * (`@myclash/types`) over what `availabilityOf` builds.
 *
 * A write replaces an axis's rows (delete, then insert). A failure between the two leaves that
 * axis with no row, which reads as "available always": the write answers 5xx and the roster
 * reloads, so the organiser sees it. Two writes for one referee racing each other (two quick
 * clicks) land in either order; the roster's reload after each save shows what was stored.
 *
 * Deleting a Tournament cascades its ticks (0077): a referee whose only tick it was becomes
 * available for every Tournament, and the roster shows "All" (ruling 150).
 */
import { BadRequestException } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ANY_AVAILABILITY, type RefereeAvailability } from '@myclash/types';
import { addDays, zonedToUtcIso } from '@myclash/time';

type Db = Pick<SupabaseClient, 'from'>;

const DAY_MINUTES = 1440;

/**
 * PostgREST's `db-max-rows` (`PGRST_DB_MAX_ROWS`, infra compose files): a longer result is cut
 * without an error, whatever `.limit()` asks. A cut list would drop someone's ticks, which reads
 * as "no restriction", so a read that reaches it answers 5xx instead.
 */
export const API_ROW_CAP = 1000;

function whole<T>(rows: T[] | null, what: string): T[] {
  const list = rows ?? [];
  if (list.length >= API_ROW_CAP) {
    throw new Error(`Could not read ${what}: ${list.length} rows reach the API's row cap`);
  }
  return list;
}

/** One ticked day: its date, and its window in minutes into the day (both null = whole day). */
export type AvailabilityDay = { date: string } & (
  { fromMinute: null; toMinute: null } | { fromMinute: number; toMinute: number }
);

/** A referee's rows as stored. An empty list = no restriction on that axis. */
export interface DeclaredAvailability {
  tournamentIds: string[];
  days: AvailabilityDay[];
}

/** The availability write's body: each axis given replaces its rows; absent = leave alone. */
export interface AvailabilityPatch {
  tournamentIds?: string[];
  days?: Array<{ date: string; fromMinute?: number; toMinute?: number }>;
}

/** Stored rows as the table holds them; its CHECK makes both minutes null or both set. */
type DayRow = { person_id: string; day: string } & (
  { from_minute: null; to_minute: null } | { from_minute: number; to_minute: number }
);

/**
 * Every referee's declaration in the Event, by person. A failed read is a 5xx, never "no
 * restriction": availability is an Impossible rule (ADR-016).
 */
export async function loadDeclaredAvailability(
  db: Db,
  eventId: string,
): Promise<Map<string, DeclaredAvailability>> {
  const byPerson = new Map<string, DeclaredAvailability>();
  const entryOf = (personId: string): DeclaredAvailability => {
    const entry = byPerson.get(personId) ?? { tournamentIds: [], days: [] };
    byPerson.set(personId, entry);
    return entry;
  };
  const { data: tournamentRows, error: tournamentError } = await db
    .from('event_referee_tournaments')
    .select('person_id, tournament_id')
    .eq('event_id', eventId);
  if (tournamentError) {
    throw new Error(`Could not read referee Tournaments: ${tournamentError.message}`);
  }
  const tournaments = whole(tournamentRows, 'referee Tournaments') as Array<{
    person_id: string;
    tournament_id: string;
  }>;
  for (const row of tournaments) {
    entryOf(row.person_id).tournamentIds.push(row.tournament_id);
  }
  const { data: dayRows, error: dayError } = await db
    .from('event_referee_days')
    .select('person_id, day, from_minute, to_minute')
    .eq('event_id', eventId)
    .order('day');
  if (dayError) throw new Error(`Could not read referee days: ${dayError.message}`);
  for (const row of whole(dayRows, 'referee days') as DayRow[]) {
    entryOf(row.person_id).days.push(
      row.from_minute === null
        ? { date: row.day, fromMinute: null, toMinute: null }
        : { date: row.day, fromMinute: row.from_minute, toMinute: row.to_minute },
    );
  }
  return byPerson;
}

/** The instant `minute` minutes into `date` on the Event's clock, DST-safe; 1440 = next midnight. */
function instantMs(date: string, minute: number, timezone: string): number {
  const day = addDays(date, Math.floor(minute / DAY_MINUTES));
  const rest = minute % DAY_MINUTES;
  const hhmm = `${String(Math.floor(rest / 60)).padStart(2, '0')}:${String(rest % 60).padStart(2, '0')}`;
  const iso = zonedToUtcIso(day, hhmm, timezone);
  if (iso === null) {
    throw new Error(`Could not place ${date} ${hhmm} (+${minute} min) on the clock ${timezone}`);
  }
  return Date.parse(iso);
}

/** Each referee's declaration as the checker reads it; someone with no rows declared none. */
export function availabilityOf(
  declared: ReadonlyMap<string, DeclaredAvailability>,
  timezone: string,
): (personId: string) => RefereeAvailability {
  const byPerson = new Map<string, RefereeAvailability>();
  for (const [personId, { tournamentIds, days }] of declared) {
    byPerson.set(personId, {
      tournamentIds: tournamentIds.length > 0 ? tournamentIds : null,
      days:
        days.length > 0
          ? days.map((d) => ({
              date: d.date,
              window: {
                startMs: instantMs(d.date, d.fromMinute ?? 0, timezone),
                endMs: instantMs(d.date, d.toMinute ?? DAY_MINUTES, timezone),
              },
            }))
          : null,
    });
  }
  return (personId) => byPerson.get(personId) ?? ANY_AVAILABILITY;
}

/** The rows a write will store, per axis given; null = that axis is left alone. */
export interface AvailabilityPlan {
  tournamentIds: string[] | null;
  days: AvailabilityDay[] | null;
}

async function eventTournamentIds(db: Db, eventId: string): Promise<string[]> {
  const { data, error } = await db.from('tournaments').select('id').eq('event_id', eventId);
  if (error) throw new Error(`Could not read the Event's Tournaments: ${error.message}`);
  return ((data ?? []) as Array<{ id: string }>).map((t) => t.id);
}

/** Every date of the Event, first to last. */
async function eventDates(db: Db, eventId: string): Promise<string[]> {
  const { data, error } = await db
    .from('events')
    .select('start_date, end_date')
    .eq('id', eventId)
    .maybeSingle();
  if (error) throw new Error(`Could not read the Event's dates: ${error.message}`);
  if (!data) throw new Error(`Event ${eventId} has no row to read its dates from`);
  const { start_date: start, end_date: end } = data as { start_date: string; end_date: string };
  const dates: string[] = [];
  for (let date: string | null = start; date !== null && date <= end; date = addDays(date, 1)) {
    dates.push(date);
  }
  return dates;
}

/**
 * Check a write against the Event and fold it to the rows to store. A Tournament of another
 * Event, or a date outside the Event's dates (ruling 149), is refused before anything is written.
 * Ticking every current Tournament is stored as no rows; so is ticking every day, unless a day
 * holds a window — a window IS a restriction (ruling 145). A window of the whole day is none.
 */
export async function planAvailability(
  db: Db,
  eventId: string,
  patch: AvailabilityPatch,
): Promise<AvailabilityPlan> {
  const plan: AvailabilityPlan = { tournamentIds: null, days: null };
  if (patch.tournamentIds !== undefined) {
    const ticked = patch.tournamentIds;
    const all = await eventTournamentIds(db, eventId);
    const foreign = ticked.find((id) => !all.includes(id));
    if (foreign) throw new BadRequestException(`Tournament ${foreign} is not part of this Event.`);
    plan.tournamentIds = all.every((id) => ticked.includes(id)) ? [] : ticked;
  }
  if (patch.days !== undefined) {
    const all = await eventDates(db, eventId);
    const outside = patch.days.find((d) => !all.includes(d.date));
    if (outside) {
      throw new BadRequestException(
        `${outside.date} is outside the Event's dates (${all[0]} to ${all[all.length - 1]}).`,
      );
    }
    const days = patch.days.map(({ date, fromMinute, toMinute }): AvailabilityDay => {
      // The body holds both minutes or neither (the controller's schema).
      if (fromMinute === undefined || toMinute === undefined) {
        return { date, fromMinute: null, toMinute: null };
      }
      if (fromMinute === 0 && toMinute === DAY_MINUTES) {
        return { date, fromMinute: null, toMinute: null };
      }
      return { date, fromMinute, toMinute };
    });
    const everyDay =
      all.every((date) => days.some((d) => d.date === date)) &&
      days.every((d) => d.fromMinute === null);
    plan.days = everyDay ? [] : days;
  }
  return plan;
}

async function replaceRows(
  db: Db,
  table: 'event_referee_tournaments' | 'event_referee_days',
  eventId: string,
  personId: string,
  rows: Array<Record<string, unknown>>,
): Promise<void> {
  const { error: deleteError } = await db
    .from(table)
    .delete()
    .eq('event_id', eventId)
    .eq('person_id', personId);
  if (deleteError) throw new Error(`Could not clear ${table}: ${deleteError.message}`);
  if (rows.length === 0) return;
  const { error: insertError } = await db
    .from(table)
    .insert(rows.map((row) => ({ event_id: eventId, person_id: personId, ...row })));
  if (insertError) throw new Error(`Could not write ${table}: ${insertError.message}`);
}

/** Store a checked plan for one referee. */
export async function applyAvailability(
  db: Db,
  eventId: string,
  personId: string,
  plan: AvailabilityPlan,
): Promise<void> {
  if (plan.tournamentIds !== null) {
    await replaceRows(
      db,
      'event_referee_tournaments',
      eventId,
      personId,
      plan.tournamentIds.map((id) => ({ tournament_id: id })),
    );
  }
  if (plan.days !== null) {
    await replaceRows(
      db,
      'event_referee_days',
      eventId,
      personId,
      plan.days.map((d) => ({ day: d.date, from_minute: d.fromMinute, to_minute: d.toMinute })),
    );
  }
}
