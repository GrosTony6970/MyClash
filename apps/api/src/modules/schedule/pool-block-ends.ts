import { BadRequestException, type Logger } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { zonedToUtcIso } from '@myclash/time';
import { barDay, readEventClock } from '../../common/event-clock';

/**
 * A fighter's Pool ends no earlier than its programme block (operator, 2026-11-27).
 *
 * A Pool's span runs from its first placed bout to the planned end of its last
 * (`resolvePoolSpans`). The organiser's programme gives the Pool phase a longer bar —
 * 09:00 to 12:00 while the last bout ends at 11:33 — and the fighter's schedule header
 * already ends at the bar (`fightHeaderEnd`, ruling 2026-09-17). The Workshop clash line
 * read the bouts alone and said "09:00–11:33" under a header that said 12:00. Now the span
 * ends at the later of the two, so both say the same.
 *
 * Plain functions taking `db`, like `next-bout-end.ts`. No authorization — every caller
 * decides who may read before it calls.
 */

/** One Pool-phase programme bar, as instants. */
export interface BlockWindow {
  startMs: number;
  endMs: number;
}

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

interface BarRow {
  competition_id: string;
  day_index: number;
  start_time: string;
  end_time: string;
}

/**
 * The Pool-phase bars of these Tournaments, keyed by Tournament id. No Tournament reads
 * nothing. A failed read, or a bar that cannot be placed on the Event's clock, is logged
 * with the Event and answers no bar at all: the spans keep their bout-based end.
 */
export async function resolvePoolBlocks(
  db: SupabaseClient,
  logger: Pick<Logger, 'warn'>,
  eventId: string,
  tournamentIds: readonly string[],
): Promise<Map<string, BlockWindow[]>> {
  const byTournament = new Map<string, BlockWindow[]>();
  if (tournamentIds.length === 0) return byTournament;
  try {
    const [{ firstDay, zone }, { data, error }] = await Promise.all([
      readEventClock(db, eventId, logger),
      db
        .from('event_programme_blocks')
        .select('competition_id, day_index, start_time, end_time')
        .eq('event_id', eventId)
        .eq('block_type', 'competition')
        .eq('competition_phase', 'pool')
        .in('competition_id', [...tournamentIds]),
    ]);
    if (error) throw new BadRequestException(error.message);
    for (const row of (data ?? []) as BarRow[]) {
      const day = barDay(firstDay, row.day_index);
      const start = day && zonedToUtcIso(day, row.start_time.slice(0, 5), zone);
      const end = day && zonedToUtcIso(day, row.end_time.slice(0, 5), zone);
      if (!start || !end) {
        throw new BadRequestException(`A Pool bar on day ${row.day_index} cannot be placed`);
      }
      const window = { startMs: Date.parse(start), endMs: Date.parse(end) };
      byTournament.set(row.competition_id, [
        ...(byTournament.get(row.competition_id) ?? []),
        window,
      ]);
    }
    return byTournament;
  } catch (err) {
    logger.warn(
      `Pool bars unreadable for event ${eventId}; Pools end with their last bout: ${messageOf(err)}`,
    );
    return new Map();
  }
}

/**
 * A Pool span's end, stretched to the end of the latest bar it overlaps. Only a bar the
 * span overlaps counts, so a Saturday Pool is not stretched to a Sunday Pool bar. A bout
 * that runs past its bar keeps its own later end. A span with no readable start or end
 * is returned as it came.
 */
export function endWithBlock(
  span: { startsAt: string | null; endsAt: string | null },
  blocks: readonly BlockWindow[],
): string | null {
  const startMs = span.startsAt ? Date.parse(span.startsAt) : NaN;
  const endMs = span.endsAt ? Date.parse(span.endsAt) : NaN;
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return span.endsAt;
  let latest = endMs;
  for (const block of blocks) {
    if (block.startMs < endMs && startMs < block.endMs && block.endMs > latest) {
      latest = block.endMs;
    }
  }
  return latest > endMs ? new Date(latest).toISOString() : span.endsAt;
}
