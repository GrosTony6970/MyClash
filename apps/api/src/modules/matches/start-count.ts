import { isOver } from '../../common/live-status';
import type { SupabaseService } from '../supabase/supabase.service';
import { eventStatusOf } from './late-press';

type Database = SupabaseService['service'];

/**
 * A bout that starts has its score counted (operator, 2026-10-11).
 *
 * A bout's row is made at 0 - 0, and only a hit, a card or "Start round"
 * counted its score. In a bout that counts down 0 - 0 means "both out of
 * points", so the TV and the public page read 0 - 0 from the Start and jumped
 * to 10 - 8 at the first hit. Now the Start counts the sheet: an empty sheet
 * reads cap to cap there, and 0 - 0 in a bout that counts up.
 *
 * ONLY A BOUT IN PLAY, AT 0 - 0, WITH NOTHING ON ITS SHEET, on an Event that
 * is not over. Such a count can complete nothing. A bout fought to its end and
 * put back in play holds hits: counting it here would complete it again before
 * the referee can correct it (`ScoringService.clockAction` says so for the
 * same reason). "In play" is asked of the row AFTER the clock took the press,
 * because the clock answers a Start it already holds whatever happened since:
 * a bout reset to "scheduled", or one of an Event that is over, is left alone.
 *
 * Two writers: a hit sent right behind the Start counts the score too. Both
 * counts are derived from the sheet; the last one wins and both are right.
 */
export interface StartCountDeps {
  db: Database;
  /** `ScoringService.recomputeMatchScore`: the score it counted. */
  recompute: (matchId: string) => Promise<{ redScore: number; blueScore: number }>;
}

interface BoutRow {
  id: string;
  status: string | null;
  red_score: number | null;
  blue_score: number | null;
}

/** The statuses the clock writes on a bout it runs: `ClockService.record`. */
const IN_PLAY: readonly (string | null)[] = ['running', 'paused'];

async function boutRow(db: Database, matchId: string): Promise<BoutRow | null> {
  const { data, error } = await db
    .from('matches')
    .select('id, status, red_score, blue_score, phases(tournaments(events(status)))')
    .eq('id', matchId)
    .maybeSingle();
  if (error) throw new Error(`Could not read a match's score: ${error.message}`);
  return data as BoutRow | null;
}

/**
 * No hit and no card that is not voided, on the bout's whole sheet or in one
 * of its rounds. A failed read is not "nothing".
 */
export async function nothingOnTheSheet(
  db: Database,
  matchId: string,
  round?: number,
): Promise<boolean> {
  for (const table of ['exchanges', 'match_penalties'] as const) {
    const rows = db.from(table).select('id').eq('match_id', matchId).eq('voided', false);
    const { data, error } = await (
      round === undefined ? rows : rows.eq('round_number', round)
    ).limit(1);
    if (error) throw new Error(`Could not read the sheet of match ${matchId}: ${error.message}`);
    if ((data ?? []).length > 0) return false;
  }
  return true;
}

const holds = (row: BoutRow | null, red: number, blue: number) =>
  row !== null && Number(row.red_score ?? 0) === red && Number(row.blue_score ?? 0) === blue;

/**
 * Count the score of a bout that has just started, and PROVE the count landed.
 *
 * The count itself throws on a sheet it cannot read, and on nothing else: a
 * bout it does not find and a row it cannot write both pass in silence. So the
 * row is read again. A row that does not hold the counted score, over a sheet
 * that is still empty, is a count that did not land: this throws, the tablet
 * keeps its Start in the queue and sends it again, and the next send comes
 * back here (the row is still 0 - 0 over an empty sheet).
 *
 * The race: a hit that lands between the count and the second read moves the
 * row. The sheet is then not empty, and that hit's own count is the right one.
 */
export async function countAtStart(deps: StartCountDeps, matchId: string): Promise<void> {
  const { db } = deps;
  const before = await boutRow(db, matchId);
  if (!before || !IN_PLAY.includes(before.status) || !holds(before, 0, 0)) return;
  if (isOver(eventStatusOf(before as unknown as Record<string, unknown>))) return;
  if (!(await nothingOnTheSheet(db, matchId))) return;

  const counted = await deps.recompute(matchId);
  if (holds(await boutRow(db, matchId), counted.redScore, counted.blueScore)) return;
  if (!(await nothingOnTheSheet(db, matchId))) return;
  throw new Error(`The score of match ${matchId} was not counted at its Start`);
}
