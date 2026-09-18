import { BadRequestException, type Logger } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveMatchLengths } from './match-lengths';
import { plannedEndIso, plannedLengthOf } from './planned-length';

/**
 * When a referee duty happens, worked out from the Matches it covers (ADR-017).
 *
 * A duty used to carry its own `starts_at` / `ends_at`, written by the referee
 * board when the organiser saved and never touched again, so it went stale the
 * moment a bout moved or the planner's length changed (dropped by 0198). Every
 * reader now asks here: a duty on one Match is that Match's planned window; a
 * duty on a Pool runs from the Pool's earliest placed Match to the planned end
 * of its last — the same start and end the referee board shows for a Pool or a
 * single bout (`assignment-board.service.ts`, `board-unit-ends.ts`). A crew on a
 * Swiss round or bracket tier is stored one duty per Match, so it reads per
 * Match here, where the board spans the round.
 *
 * Plain functions taking `db`, like `match-lengths.ts`, and for the same
 * reasons: no module edge, and no authorization — every caller decides who may
 * read before it calls.
 */

/** A duty as `referee_assignments` stores its scope. */
export interface DutyRef {
  id: string;
  /** The duty's own `match_id`. When set, the duty covers that Match alone. */
  matchId: string | null;
  /**
   * The duty's own `pool_id` — never the Pool a Match-scoped duty's Match sits
   * in, which would stretch one bout's duty over the whole Pool.
   */
  poolId: string | null;
}

/** A duty's times as ISO strings; null where nothing is placed or known. */
export interface DutyWindow {
  startsAt: string | null;
  endsAt: string | null;
}

interface DutyMatch {
  id: string;
  poolId: string | null;
  phaseId: string;
  scheduledAt: string | null;
  plannedDurationOverrideMinutes: number | null;
}

const MATCH_COLUMNS = 'id, pool_id, phase_id, scheduled_at, planned_duration_override_minutes';

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/**
 * PostgREST puts `.in()` values in the URL; keep each request well under any
 * limit. A referee on Swiss or bracket crews holds one duty per Match, so one
 * person's list across every Event can pass it.
 */
const IN_CHUNK = 200;

async function readMatches(
  db: SupabaseClient,
  column: 'id' | 'pool_id',
  values: readonly string[],
): Promise<DutyMatch[]> {
  const chunks: string[][] = [];
  for (let i = 0; i < values.length; i += IN_CHUNK) chunks.push(values.slice(i, i + IN_CHUNK));
  const pages = await Promise.all(
    chunks.map(async (chunk) => {
      const { data, error } = await db.from('matches').select(MATCH_COLUMNS).in(column, chunk);
      if (error) throw new BadRequestException(error.message);
      return (data ?? []) as Array<{
        id: string;
        pool_id: string | null;
        phase_id: string;
        scheduled_at: string | null;
        planned_duration_override_minutes: number | null;
      }>;
    }),
  );
  return pages.flat().map((row) => ({
    id: row.id,
    poolId: row.pool_id,
    phaseId: row.phase_id,
    scheduledAt: row.scheduled_at,
    plannedDurationOverrideMinutes: row.planned_duration_override_minutes,
  }));
}

/**
 * The Matches each duty covers, keyed by duty id: its own Match when it names
 * one, else every Match of its own Pool. A duty with neither (a Lice-scoped row,
 * which nothing writes) covers none. Two reads at most, run together.
 */
async function readDutyMatches(
  db: SupabaseClient,
  duties: readonly DutyRef[],
): Promise<Map<string, DutyMatch[]>> {
  const matchIds = [...new Set(duties.flatMap((duty) => (duty.matchId ? [duty.matchId] : [])))];
  const poolIds = [
    ...new Set(duties.flatMap((duty) => (!duty.matchId && duty.poolId ? [duty.poolId] : []))),
  ];
  const [byId, byPool] = await Promise.all([
    readMatches(db, 'id', matchIds),
    readMatches(db, 'pool_id', poolIds),
  ]);
  return new Map(
    duties.map((duty) => [
      duty.id,
      duty.matchId
        ? byId.filter((match) => match.id === duty.matchId)
        : byPool.filter((match) => match.poolId === duty.poolId),
    ]),
  );
}

/** The earliest placed Match's start, compared as an instant. Null when none is placed. */
function earliestStartIso(matches: readonly DutyMatch[]): string | null {
  let earliest: number | null = null;
  for (const match of matches) {
    if (match.scheduledAt === null) continue;
    const ms = Date.parse(match.scheduledAt);
    if (earliest === null || ms < earliest) earliest = ms;
  }
  return earliest === null ? null : new Date(earliest).toISOString();
}

/**
 * When one duty starts: the earliest placed Match it covers. Needs no length,
 * so a reminder can be timed even when the Event's sheet cannot be read.
 */
export async function readDutyStart(db: SupabaseClient, duty: DutyRef): Promise<string | null> {
  const matches = await readDutyMatches(db, [duty]);
  return earliestStartIso(matches.get(duty.id) ?? []);
}

/**
 * The planned lengths of one Event's placed Matches, from that Event's sheet,
 * or null when they cannot be resolved — logged with the Event, naming `what`
 * loses its end.
 */
async function eventLengths(
  db: SupabaseClient,
  logger: Pick<Logger, 'warn'>,
  eventId: string,
  matches: readonly DutyMatch[],
  what: string,
): Promise<Map<string, number> | null> {
  const placed = new Map<string, DutyMatch>();
  for (const match of matches) if (match.scheduledAt !== null) placed.set(match.id, match);
  try {
    return await resolveMatchLengths(db, eventId, [...placed.values()]);
  } catch (err) {
    logger.warn(
      `Planned lengths unreadable for event ${eventId}; ${what} show no end: ${messageOf(err)}`,
    );
    return null;
  }
}

function dutyWindow(
  matches: readonly DutyMatch[],
  lengths: Map<string, number> | null,
): DutyWindow {
  const timed = matches.filter((match) => match.scheduledAt !== null);
  return {
    startsAt: earliestStartIso(matches),
    endsAt: lengths
      ? plannedEndIso(
          timed.map((match) => ({
            scheduledAt: match.scheduledAt,
            durationMinutes: plannedLengthOf(lengths, match.id),
          })),
        )
      : null,
  };
}

/**
 * Each duty's start and end, keyed by duty id — an entry for every duty, for a
 * page that must render whatever happens here.
 *
 * Lengths are resolved once per Event, and each Event on its own: a sheet that
 * cannot be read (a stored value the schema refuses throws, by design) costs
 * that Event's duties their END and nothing else. Their start needs no length.
 * When the Matches themselves cannot be read, every duty is untimed. Both are
 * logged with the Events concerned; neither throws.
 */
export async function resolveDutyWindows(
  db: SupabaseClient,
  logger: Pick<Logger, 'warn'>,
  duties: ReadonlyArray<DutyRef & { eventId: string }>,
): Promise<Map<string, DutyWindow>> {
  const eventIds = [...new Set(duties.map((duty) => duty.eventId))];
  let matchesByDuty: Map<string, DutyMatch[]>;
  try {
    matchesByDuty = await readDutyMatches(db, duties);
  } catch (err) {
    logger.warn(
      `Referee duty times unreadable for event ${eventIds.join(', ')}; every duty is untimed: ${messageOf(err)}`,
    );
    return new Map(duties.map((duty) => [duty.id, { startsAt: null, endsAt: null }]));
  }

  const windows = new Map<string, DutyWindow>();
  await Promise.all(
    eventIds.map(async (eventId) => {
      const own = duties.filter((duty) => duty.eventId === eventId);
      const lengths = await eventLengths(
        db,
        logger,
        eventId,
        own.flatMap((duty) => matchesByDuty.get(duty.id) ?? []),
        'its referee duties',
      );
      for (const duty of own) {
        windows.set(duty.id, dutyWindow(matchesByDuty.get(duty.id) ?? [], lengths));
      }
    }),
  );
  return windows;
}

/**
 * A fighter's Pools, each with the span a Pool duty on it would have: from the
 * Pool's earliest placed Match to the planned end of its last, whoever fights
 * them (ADR-017). A fighter is busy for their whole Pool, not only their own
 * bouts (operator, 2026-09-17) — the reason a referee on a Pool is on the Lice
 * between its Matches, and the same span.
 *
 * One Event: a fighter's schedule is read per Event. Every Pool asked about
 * comes back, in order and with whatever it carried in, with null times where
 * nothing is placed or known. A failed read is logged, never thrown, as for the
 * duties.
 */
export async function resolvePoolSpans<P extends { poolId: string }>(
  db: SupabaseClient,
  logger: Pick<Logger, 'warn'>,
  eventId: string,
  pools: readonly P[],
): Promise<Array<P & DutyWindow>> {
  // No Pools reads nothing: the read is chunked, and no chunk means no request.
  let matches: DutyMatch[];
  try {
    matches = await readMatches(
      db,
      'pool_id',
      pools.map((pool) => pool.poolId),
    );
  } catch (err) {
    logger.warn(
      `Pool spans unreadable for event ${eventId}; every Pool is untimed: ${messageOf(err)}`,
    );
    return pools.map((pool) => ({ ...pool, startsAt: null, endsAt: null }));
  }
  const lengths = await eventLengths(db, logger, eventId, matches, 'its Pool spans');
  return pools.map((pool) => ({
    ...pool,
    ...dutyWindow(
      matches.filter((match) => match.poolId === pool.poolId),
      lengths,
    ),
  }));
}
