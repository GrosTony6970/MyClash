import { BadRequestException, type Logger } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { addDays, zonedDay, zonedToUtcIso } from '@myclash/time';

/**
 * Where a bout ends when its planned length cannot be known — a FALLBACK only
 * (operator, 2026-09-18).
 *
 * A length is unknown when the Event's planner sheet cannot be read, and then
 * every bout of the Event loses it at once (`match-lengths.ts`). ADR-017's rule
 * stands: a Match's length never depends on the Match next to it. This answers
 * only what the clash check still needs when there is no length at all.
 *
 * The bout ends at the earlier of the next bout on its piste the same Event day
 * and the next break or admin bar that day. A competition bar does not stop it —
 * the bout runs inside one — and a workshop bar runs beside it. With neither, the
 * bout has no end, and the pages say how many commitments they cannot check.
 *
 * Plain functions taking `db`, like `duty-windows.ts`, which asks here for duty
 * and Pool ends while `public-schedule.service.ts` asks for a fighter's own
 * bouts: a bout, a duty and a Pool on one page get one answer. No
 * authorization — every caller decides who may read before it calls.
 */

/** A bout as a caller holds it. */
export interface BoutRef {
  id: string;
  liceId: string | null;
  scheduledAt: string | null;
}

/** A moment, with the Event day it falls on. */
interface Dated {
  ms: number;
  day: string;
}

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** The Event day of an instant, on the Event's clock, or a throw. */
function dayOf(iso: string, timezone: string): string {
  const day = zonedDay(iso, timezone);
  if (!day) throw new BadRequestException(`${iso} cannot be read in ${timezone}`);
  return day;
}

async function readClock(
  db: SupabaseClient,
  eventId: string,
): Promise<{ firstDay: string; timezone: string }> {
  const { data, error } = await db
    .from('events')
    .select('start_date, timezone')
    .eq('id', eventId)
    .maybeSingle();
  if (error) throw new BadRequestException(error.message);
  const row = data as { start_date: string; timezone: string } | null;
  if (!row) throw new BadRequestException(`Event ${eventId} does not exist`);
  const firstDay = addDays(row.start_date.slice(0, 10), 0);
  if (!firstDay) {
    throw new BadRequestException(`Event ${eventId} starts on "${row.start_date}", not a day`);
  }
  return { firstDay, timezone: row.timezone };
}

async function readBarRows(
  db: SupabaseClient,
  eventId: string,
): Promise<Array<{ day_index: number; start_time: string }>> {
  const { data, error } = await db
    .from('event_programme_blocks')
    .select('day_index, start_time')
    .eq('event_id', eventId)
    .in('block_type', ['break', 'admin']);
  if (error) throw new BadRequestException(error.message);
  return (data ?? []) as Array<{ day_index: number; start_time: string }>;
}

/** Every placed bout that will happen on these pistes. A Lice belongs to one Event. */
async function readPisteRows(
  db: SupabaseClient,
  liceIds: readonly string[],
): Promise<Array<{ lice_id: string; scheduled_at: string }>> {
  if (liceIds.length === 0) return [];
  const { data, error } = await db
    .from('matches')
    .select('id, lice_id, scheduled_at')
    .in('lice_id', liceIds)
    .not('scheduled_at', 'is', null)
    // A voided bout keeps its piste and time on the row, and never happens.
    .not('status', 'eq', 'voided');
  if (error) throw new BadRequestException(error.message);
  return (data ?? []) as Array<{ lice_id: string; scheduled_at: string }>;
}

/** The earliest of the bout's next bout on its piste and the day's next bar, after its start. */
function endOf(
  bout: Dated & { liceId: string | null },
  piste: Array<Dated & { liceId: string }>,
  bars: Dated[],
): number | null {
  // A bout with no piste matches no row here: every row read has one.
  const later = [...piste.filter((other) => other.liceId === bout.liceId), ...bars].filter(
    (next) => next.day === bout.day && next.ms > bout.ms,
  );
  return later.length > 0 ? Math.min(...later.map((next) => next.ms)) : null;
}

/**
 * Each bout's fallback end as an ISO string, keyed by bout id — an entry for every
 * bout asked about, null where there is no next bout and no bar that day, or the
 * bout is not placed. A failed read is logged with the Event and answers every
 * bout with no end; it never throws.
 */
export async function resolveNextBoutEnds(
  db: SupabaseClient,
  logger: Pick<Logger, 'warn'>,
  eventId: string,
  bouts: readonly BoutRef[],
): Promise<Map<string, string | null>> {
  const ends = new Map<string, string | null>(bouts.map((bout) => [bout.id, null]));
  const placed = bouts.flatMap((bout) =>
    bout.scheduledAt === null ? [] : [{ ...bout, scheduledAt: bout.scheduledAt }],
  );
  if (placed.length === 0) return ends;
  try {
    const liceIds = [...new Set(placed.flatMap((bout) => (bout.liceId ? [bout.liceId] : [])))];
    const [{ firstDay, timezone }, barRows, pisteRows] = await Promise.all([
      readClock(db, eventId),
      readBarRows(db, eventId),
      readPisteRows(db, liceIds),
    ]);
    const bars = barRows.map((row): Dated => {
      const day = addDays(firstDay, row.day_index);
      const iso = zonedToUtcIso(day, row.start_time.slice(0, 5), timezone);
      if (!day || !iso)
        throw new BadRequestException(`A bar on day ${row.day_index} cannot be placed`);
      return { ms: Date.parse(iso), day };
    });
    const piste = pisteRows.map((row) => ({
      liceId: row.lice_id,
      ms: Date.parse(row.scheduled_at),
      day: dayOf(row.scheduled_at, timezone),
    }));
    for (const bout of placed) {
      const ms = Date.parse(bout.scheduledAt);
      const end = endOf(
        { liceId: bout.liceId, ms, day: dayOf(bout.scheduledAt, timezone) },
        piste,
        bars,
      );
      ends.set(bout.id, end === null ? null : new Date(end).toISOString());
    }
    return ends;
  } catch (err) {
    logger.warn(
      `Next-bout ends unreadable for event ${eventId}; bouts with no length show no end: ${messageOf(err)}`,
    );
    return new Map(bouts.map((bout) => [bout.id, null]));
  }
}
