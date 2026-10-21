import { BadRequestException, type Logger } from '@nestjs/common';
import type { ForfeitOutcome } from '@myclash/rulesets';
import type { SupabaseService } from '../supabase/supabase.service';
import {
  matchRulesetForTournament,
  tournamentOfBout,
  type MatchRulesetStamp,
} from '../phases/match-ruleset';
import type { ClockService } from './clock.service';
import type { ScoringService } from './scoring.service';

/**
 * The bout half of a forfeit: what a forfeit writes on its bout, and how a take-back puts the bout
 * back. One owner for the door that records a forfeit (`MatchForfeitsService`) and for the status
 * reconcile that forfeits and brings back a Fighter's Pool bouts (`fighter-reconcile.ts`).
 *
 * Free functions over `deps`, not a service: the reconcile lives in `FighterStatusService`, which
 * `MatchForfeitsService` injects, so a shared service would be a third provider for one concern.
 */

type Client = SupabaseService['service'];
type Row = Record<string, unknown>;

export interface BoutDeps {
  db: Client;
  clock?: Pick<ClockService, 'getClockState' | 'clockAction'>;
  scoring?: Pick<ScoringService, 'recomputeMatchScore'>;
  logger: Pick<Logger, 'log' | 'warn'>;
}

/** The Postgres code of a unique violation: `match_forfeits_one_active_per_match` (0032). */
export const UNIQUE_VIOLATION = '23505';

/**
 * Insert one forfeit record, and the database's answer as it is: the door that records a forfeit
 * refuses a failed insert as it always has, the reconcile reads a unique violation as "this bout
 * already holds a live record".
 */
export async function insertForfeit(
  db: Client,
  row: Row,
): Promise<{ data: Row | null; error: { code?: string; message: string } | null }> {
  const { data, error } = await db.from('match_forfeits').insert(row).select('*').single();
  return { data: (data as Row | null) ?? null, error };
}

/** Who wins a forfeit's bout: the other Fighter, or no one on a draw (ruling 64). */
export function winnerOf(
  match: { red_registration_id?: unknown; blue_registration_id?: unknown },
  forfeitingRegistrationId: string,
  policy: ForfeitOutcome,
): string | null {
  if (policy.scorePolicy === 'draw') return null;
  const other =
    forfeitingRegistrationId === match.red_registration_id
      ? match.blue_registration_id
      : match.red_registration_id;
  return other as string;
}

/**
 * An override's scores: it states the result; there is nothing to derive. The DTO guarantees the
 * pair is present for an override reason and absent otherwise, so a missing pair here would be a
 * wiring bug, not input.
 */
function explicitScores(
  redForfeits: boolean,
  explicit: { forfeitingScore: number; opponentScore: number } | undefined,
) {
  if (!explicit) {
    throw new BadRequestException('An override requires explicit scores');
  }
  return {
    redScore: redForfeits ? explicit.forfeitingScore : explicit.opponentScore,
    blueScore: redForfeits ? explicit.opponentScore : explicit.forfeitingScore,
    forfeitingScore: explicit.forfeitingScore,
    opponentScore: explicit.opponentScore,
  };
}

/** The scores a forfeit writes on its bout, by its score policy. */
export function resolveScores(
  match: Row,
  forfeitingRegistrationId: string,
  policy: { scorePolicy: string; lossScore: number; opponentScore: number },
  explicit?: { forfeitingScore: number; opponentScore: number },
) {
  const redForfeits = forfeitingRegistrationId === match['red_registration_id'];
  if (policy.scorePolicy === 'explicit') return explicitScores(redForfeits, explicit);

  // A draw is 0-0 with no winner, as a double-hit ceiling draw is (ruling 64).
  if (policy.scorePolicy === 'draw') {
    return { redScore: 0, blueScore: 0, forfeitingScore: 0, opponentScore: 0 };
  }

  const currentForfeitingScore =
    Number(redForfeits ? match['red_score'] : match['blue_score']) || 0;
  const currentOpponentScore = Number(redForfeits ? match['blue_score'] : match['red_score']) || 0;
  return {
    redScore:
      policy.scorePolicy === 'keep_current'
        ? Number(match['red_score'] ?? 0)
        : redForfeits
          ? policy.lossScore
          : policy.opponentScore,
    blueScore:
      policy.scorePolicy === 'keep_current'
        ? Number(match['blue_score'] ?? 0)
        : redForfeits
          ? policy.opponentScore
          : policy.lossScore,
    forfeitingScore:
      policy.scorePolicy === 'keep_current' ? currentForfeitingScore : policy.lossScore,
    opponentScore:
      policy.scorePolicy === 'keep_current' ? currentOpponentScore : policy.opponentScore,
  };
}

/**
 * Complete a bout a forfeit ended, and stop its clock so it freezes and the scoreboard's endcard
 * fires. The bout write is checked: a forfeit record standing on a bout still in play is the
 * half-done state a retry has to find. The clock is best-effort: the bout is completed by then,
 * and only a running or halted clock can end.
 */
export async function completeMatch(
  deps: BoutDeps,
  matchId: string,
  result: {
    winnerRegistrationId: string | null;
    scores: { redScore: number; blueScore: number };
    endReason: string;
    endedAt?: string;
    causedAt?: string;
  },
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await deps.db
    .from('matches')
    .update({
      status: 'completed',
      ended_at: result.endedAt ?? now,
      winner_registration_id: result.winnerRegistrationId,
      red_score: result.scores.redScore,
      blue_score: result.scores.blueScore,
      // 'black_card' | 'forfeit' — lets the pad + TV label the result.
      end_reason: result.endReason,
      updated_at: now,
    })
    .eq('id', matchId);
  if (error) throw new Error(`Match ${matchId} was not completed by its forfeit: ${error.message}`);

  if (!deps.clock) return;
  try {
    const clk = await deps.clock.getClockState(matchId);
    if (clk.status === 'running' || clk.status === 'halted') {
      const opensLock = { canOverrideLocked: true };
      await deps.clock.clockAction(
        matchId,
        'end',
        'auto: forfeit',
        opensLock,
        false,
        result.causedAt,
      );
    }
  } catch (err) {
    // Best-effort, and said: the bout is completed with a clock that still runs.
    deps.logger.warn(`Clock end skipped after the forfeit of match ${matchId}`, err);
  }
}

/**
 * The six columns a forfeit changes on its bout, as they stand. Whatever the snapshot omits, the
 * void cannot restore: `end_reason` was once omitted, and every void left the bout claiming it
 * ended the way the voided record said it did.
 */
export function matchSnapshot(match: Row) {
  return {
    status: match['status'],
    red_score: match['red_score'],
    blue_score: match['blue_score'],
    winner_registration_id: match['winner_registration_id'] ?? null,
    ended_at: match['ended_at'] ?? null,
    end_reason: match['end_reason'] ?? null,
  };
}

/**
 * The six snapshot columns, read fresh. Null when the match is gone; a read that failed is a
 * server error, never "nothing to compare" (a void would write over a bout fought since).
 */
async function readMatchSnapshot(db: Client, matchId: string): Promise<Row | null> {
  const { data, error } = await db
    .from('matches')
    .select('status, red_score, blue_score, winner_registration_id, ended_at, end_reason')
    .eq('id', matchId)
    .maybeSingle();
  if (error) throw new Error(`Match ${matchId} could not be read: ${error.message}`);
  return data ? matchSnapshot(data as Row) : null;
}

/**
 * Record the result this forfeit produced, so a later void can tell whether the bout still holds
 * it. Read fresh at the END of the write: a bracket round-1 forfeit with a reserve finishes
 * `scheduled`, not `completed`.
 */
export async function stampResultingState(
  db: Client,
  forfeitId: string,
  matchId: string,
): Promise<void> {
  const resulting = await readMatchSnapshot(db, matchId);
  if (!resulting) return;
  const { error } = await db
    .from('match_forfeits')
    .update({ resulting_match_state: resulting, updated_at: new Date().toISOString() })
    .eq('id', forfeitId);
  // Unsaved, a later void compares nothing and puts the bout back over a result fought since.
  if (error) throw new Error(`Forfeit ${forfeitId} did not keep its result: ${error.message}`);
}

/** What makes one result different from another. See `recordedResultDiverged`. */
const RESULT_DECISION_KEYS = [
  'status',
  'winner_registration_id',
  'red_score',
  'blue_score',
  'end_reason',
] as const;

/**
 * Has the bout moved off the result this record produced? Null when there is nothing to compare
 * (a record written before migration 0186 carries an empty object). `ended_at` is NOT compared:
 * it comes back from Postgres in another string form than the ISO value written. A real fight
 * writes its own `end_reason`, never 'forfeit' or 'black_card'.
 */
export async function recordedResultDiverged(
  db: Client,
  matchId: string,
  forfeit: Row,
): Promise<boolean | null> {
  const recorded = (forfeit['resulting_match_state'] as Row | null) ?? {};
  if (Object.keys(recorded).length === 0) return null;
  const current = await readMatchSnapshot(db, matchId);
  if (!current) return null;
  return RESULT_DECISION_KEYS.some((key) => (current[key] ?? null) !== (recorded[key] ?? null));
}

/**
 * Put the bout back the way `matchSnapshot` found it. Every column here has a counterpart there.
 * `rulesets` holds the bouts that go back to "not started", each with the ruleset it takes in this
 * same write (`rulesetsOfBoutsPutBack`); such a bout forgets the copies it held before.
 */
export async function restoreMatchState(
  db: Client,
  matchId: string,
  previous: Row,
  rulesets: ReadonlyMap<string, MatchRulesetStamp>,
): Promise<void> {
  const rules = rulesets.get(matchId);
  const { error } = await db
    .from('matches')
    .update({
      status: previous['status'] ?? 'scheduled',
      ...(rules ? { ...rules, earlier_rules_ids: [] } : {}),
      red_score: previous['red_score'] ?? 0,
      blue_score: previous['blue_score'] ?? 0,
      winner_registration_id: previous['winner_registration_id'] ?? null,
      ended_at: previous['ended_at'] ?? null,
      end_reason: previous['end_reason'] ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', matchId);
  if (error) throw new Error(`Match ${matchId} was not put back: ${error.message}`);
}

/**
 * The ruleset each bout takes when a take-back puts it back to "not started": its Tournament's of
 * now, as a reset does. Read for every such bout before anything is written; one stamp per
 * Tournament. A bout the forfeit found started keeps its own and is not in the answer.
 */
export async function rulesetsOfBoutsPutBack(
  db: Client,
  records: Row[],
): Promise<Map<string, MatchRulesetStamp>> {
  const rulesets = new Map<string, MatchRulesetStamp>();
  const byTournament = new Map<string, MatchRulesetStamp>();
  for (const record of records) {
    const previous = (record['previous_match_state'] as Row | null) ?? {};
    if ((previous['status'] ?? 'scheduled') !== 'scheduled') continue;
    const matchId = record['match_id'] as string;
    const tournamentId = await tournamentOfBout(db, matchId);
    const stamp =
      byTournament.get(tournamentId) ?? (await matchRulesetForTournament(db, tournamentId));
    byTournament.set(tournamentId, stamp);
    rulesets.set(matchId, stamp);
  }
  return rulesets;
}

/**
 * Which of these bouts are mid-bout ('running' or 'paused'), so must not be rewritten: a reset and
 * the clock's reopen put a forfeited bout back in play with its record still live. Restoring the
 * snapshot over one would wipe its score. A bout put back and fought to a finish is 'completed'
 * again; the caller pairs this with `recordedResultDiverged` for that case.
 */
export async function liveMatchIds(db: Client, matchIds: string[]): Promise<Set<string>> {
  if (matchIds.length === 0) return new Set();
  const { data, error } = await db.from('matches').select('id, status').in('id', matchIds);
  if (error) throw new Error(`The bouts to put back could not be read: ${error.message}`);
  return new Set(
    ((data ?? []) as Row[])
      .filter((row) => ['running', 'paused'].includes(String(row['status'])))
      .map((row) => row['id'] as string),
  );
}

/**
 * A bout the take-back puts back in play gets its ended clock reopened (operator ruling
 * 2026-10-16, "Forfeit back"): the Reopen halts it, and the bout waits "paused" for the referee's
 * Resume. Before the sheet is read again, which may end the bout and its clock at once.
 *
 * Never throws: the void is saved by now, and the referee's own Reopen still works.
 */
export async function reopenClockTakenBack(
  deps: BoutDeps,
  matchId: string,
  previous: Row,
): Promise<void> {
  if (!deps.clock || (previous['status'] !== 'running' && previous['status'] !== 'paused')) {
    return;
  }
  try {
    if ((await deps.clock.getClockState(matchId)).status !== 'ended') return;
    const opensLock = { canOverrideLocked: true };
    await deps.clock.clockAction(matchId, 'reopen', 'auto: forfeit taken back', opensLock);
  } catch (err) {
    deps.logger.warn(`Match ${matchId} kept the clock its forfeit ended`, err);
  }
}

/**
 * Ruling 322: while the record stood, the bout kept the record's result whatever was added to its
 * sheet. Back in play, it reads the sheet again (ruling 330 for the Pool bouts put back with it).
 * NOT a bout the restore leaves completed (an override over a bout fought to its end): a recompute
 * would hand a time-ended bout of a running Event back to its referee.
 *
 * Never throws: the void is saved by now.
 */
export async function readSheetAgain(
  deps: BoutDeps,
  matchId: string,
  previous: Row,
): Promise<void> {
  if (previous['status'] === 'completed') {
    deps.logger.log(`Match ${matchId} is completed again as it was: its sheet was not read`);
    return;
  }
  try {
    await deps.scoring?.recomputeMatchScore(matchId);
  } catch (err) {
    deps.logger.warn(`Match ${matchId} did not read its sheet again after a forfeit's void`, err);
  }
}
