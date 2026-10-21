import { restampAfterInsert, type MatchRulesetStamp } from '../phases/match-ruleset';
import { forfeitOutcomeOf } from '@myclash/rulesets';
import type { ForfeitRulesInForce } from '@myclash/types/forfeit-rules';
import {
  completeMatch,
  insertForfeit,
  liveMatchIds,
  matchSnapshot,
  readSheetAgain,
  recordedResultDiverged,
  reopenClockTakenBack,
  resolveScores,
  restoreMatchState,
  rulesetsOfBoutsPutBack,
  stampResultingState,
  UNIQUE_VIOLATION,
  winnerOf,
  type BoutDeps,
} from './fighter-bouts';
import { causeOf, liveForfeitsOf, rowsOf, type Cause, type Fighter } from './fighter-cause';
import { forfeitEndReason } from './forfeit-end-reason';
import { stampForfeitVoided, type ForfeitVoidActor } from './forfeit-void';

/**
 * A Fighter's Pool bouts follow their status (slice B, B2; rulings 57, 78, 105, 109, 110).
 *
 * - Out (withdrawn or disqualified, whatever the cause): `takeOut` forfeits each of their
 *   scheduled or paused bouts in every Pool phase of the Tournament, except a bout whose forfeit
 *   the organiser voided during the current spell out (`voided_at >= out_since`, the void not the
 *   reconcile's own): she put it back, and it stays back until the Fighter's next spell.
 * - In: `bringBack` voids the records written because the Fighter was out — every live forfeit
 *   the reconcile wrote, and every one a person recorded under a withdrawal that is voided since
 *   (ruling 105) — and puts their bouts back unless they are in play or were fought again.
 *
 * Both are safe to run again, which is how a door cut short is repaired: its retry settles, and
 * the reconcile after the settle finds what is left to do. A Pool bout feeds no bracket slot, so
 * putting one back un-advances nothing (a bracket the Pool already filled stays, §6).
 */

type Client = BoutDeps['db'];
type Row = Record<string, unknown>;

/** What one `takeOut` did: the bouts it forfeited, and one of them per Pool phase. */
export interface TakenOut {
  forfeited: number;
  boutPerPhase: Map<string, string>;
}

// ── Out ─────────────────────────────────────────────────────────────────────────

/** The Fighter's scheduled or paused bouts of every Pool phase, but the ones put back by hand. */
async function boutsToTakeOut(db: Client, fighter: Fighter): Promise<Row[]> {
  const phases = rowsOf(
    'The Pool phases',
    await db
      .from('phases')
      .select('id')
      .eq('tournament_id', fighter.tournamentId)
      .eq('type', 'pool'),
  );
  if (phases.length === 0) return [];
  const bouts = rowsOf(
    'The Pool bouts of the Fighter',
    await db
      .from('matches')
      .select(
        'id, phase_id, red_registration_id, blue_registration_id, red_score, blue_score, status, winner_registration_id, ended_at, end_reason',
      )
      .in(
        'phase_id',
        phases.map((phase) => phase['id'] as string),
      )
      .in('status', ['scheduled', 'paused'])
      .or(`red_registration_id.eq.${fighter.id},blue_registration_id.eq.${fighter.id}`),
  );
  if (bouts.length === 0) return [];
  const putBack = rowsOf(
    'The bouts put back by hand',
    await db
      .from('match_forfeits')
      .select('match_id')
      .eq('tournament_id', fighter.tournamentId)
      .eq('forfeiting_registration_id', fighter.id)
      .eq('auto_created', true)
      .eq('voided_by_return', false)
      // Never null while the Fighter is out: the CHECK of 0240 ties it to the status.
      .gte('voided_at', fighter.outSince as string),
  );
  const handled = new Set(putBack.map((row) => row['match_id'] as string));
  return bouts.filter((bout) => !handled.has(bout['id'] as string));
}

/** Forfeit the Fighter's bouts while they are out; one bout per Pool phase it completed bouts in. */
export async function takeOut(
  deps: BoutDeps,
  fighter: Fighter,
  rules: ForfeitRulesInForce,
  actor: ForfeitVoidActor,
): Promise<TakenOut> {
  const taken: TakenOut = { forfeited: 0, boutPerPhase: new Map() };
  const bouts = await boutsToTakeOut(deps.db, fighter);
  if (bouts.length === 0) return taken;
  const cause = await causeOf(deps.db, fighter, rules, await liveForfeitsOf(deps.db, fighter));
  for (const bout of bouts) {
    if (!(await forfeitBout(deps, fighter, bout, cause, rules, actor))) continue;
    taken.forfeited += 1;
    if (!taken.boutPerPhase.has(bout['phase_id'] as string)) {
      taken.boutPerPhase.set(bout['phase_id'] as string, bout['id'] as string);
    }
  }
  return taken;
}

/** One bout forfeited by the Fighter's cause. False when another record already holds it. */
async function forfeitBout(
  deps: BoutDeps,
  fighter: Fighter,
  bout: Row,
  cause: Cause,
  rules: ForfeitRulesInForce,
  actor: ForfeitVoidActor,
): Promise<boolean> {
  const policy = forfeitOutcomeOf(rules, cause.reason, 'pool');
  const winnerRegistrationId = winnerOf(bout, fighter.id, policy);
  const scores = resolveScores(bout, fighter.id, policy);
  const { data, error } = await insertForfeit(deps.db, {
    match_id: bout['id'],
    tournament_id: fighter.tournamentId,
    forfeiting_registration_id: fighter.id,
    winner_registration_id: winnerRegistrationId,
    reason: cause.reason,
    score_policy: policy.scorePolicy,
    forfeiting_score: scores.forfeitingScore,
    opponent_score: scores.opponentScore,
    can_continue: false,
    auto_created: true,
    parent_forfeit_id: cause.parentForfeitId,
    previous_match_state: matchSnapshot(bout),
    by_user_id: actor.userId ?? null,
    staff_account_id: actor.staffAccountId ?? null,
  });
  if (error?.code === UNIQUE_VIOLATION) return finishHeldBout(deps, fighter, bout);
  if (error || !data) {
    throw new Error(`Bout ${String(bout['id'])} was not forfeited: ${error?.message ?? 'no row'}`);
  }
  const endReason = forfeitEndReason(cause.reason);
  await completeMatch(deps, bout['id'] as string, { winnerRegistrationId, scores, endReason });
  await stampResultingState(deps.db, data['id'] as string, bout['id'] as string);
  return true;
}

/**
 * The bout already holds a live record. When it is this Fighter's, written by a reconcile cut
 * short before it completed the bout, the bout is completed by it now; anyone else's is left.
 */
async function finishHeldBout(deps: BoutDeps, fighter: Fighter, bout: Row): Promise<boolean> {
  const held = rowsOf(
    'The live forfeit of the bout',
    await deps.db
      .from('match_forfeits')
      .select('*')
      .eq('match_id', bout['id'] as string)
      .is('voided_at', null),
  )[0];
  if (!held || held['forfeiting_registration_id'] !== fighter.id || !held['auto_created']) {
    return false;
  }
  const redForfeits = bout['red_registration_id'] === fighter.id;
  const own = Number(held['forfeiting_score']);
  const other = Number(held['opponent_score']);
  await completeMatch(deps, bout['id'] as string, {
    winnerRegistrationId: (held['winner_registration_id'] as string | null) ?? null,
    scores: { redScore: redForfeits ? own : other, blueScore: redForfeits ? other : own },
    endReason: forfeitEndReason(held['reason'] as string),
  });
  await stampResultingState(deps.db, held['id'] as string, bout['id'] as string);
  return true;
}

// ── In ──────────────────────────────────────────────────────────────────────────

/** What one `bringBack` did: the records it voided, and the bouts it put back. */
export interface BroughtBack {
  voided: number;
  putBack: string[];
}

/**
 * Void what was written because the Fighter was out, and put each bout back: every live record
 * the reconcile wrote, every one a person recorded under a withdrawal voided since (ruling 105),
 * and every one recorded under the organiser's hand withdrawal (ruling 118: the Fighter is in, so
 * that withdrawal is undone). Not a record that disqualified on its own (a conduct forfeit recorded
 * under a withdrawal, ruling 112): it stores an outcome, and while it is live the Fighter is not in.
 */
export async function bringBack(
  deps: BoutDeps,
  fighter: Fighter,
  actor: ForfeitVoidActor,
): Promise<BroughtBack> {
  const forfeits = await liveForfeitsOf(deps.db, fighter);
  const auto = forfeits.filter((f) => f['auto_created'] === true);
  const byHand = forfeits.filter((f) => !f['auto_created'] && f['fighter_outcome'] == null);
  const underRoot = byHand.filter((f) => f['parent_forfeit_id'] != null);
  const voidedRoots = await voidedAmong(
    deps.db,
    underRoot.map((f) => f['parent_forfeit_id'] as string),
  );
  const records = [
    ...auto,
    ...underRoot.filter((f) => voidedRoots.has(f['parent_forfeit_id'] as string)),
    ...byHand.filter((f) => f['under_hand_withdrawal'] === true && f['parent_forfeit_id'] == null),
  ];
  const back: BroughtBack = { voided: records.length, putBack: [] };
  if (records.length === 0) return back;

  // Every read that can fail before the first write.
  const rulesets = await rulesetsOfBoutsPutBack(deps.db, records);
  const live = await liveMatchIds(
    deps.db,
    records.map((f) => f['match_id'] as string),
  );
  for (const record of records) {
    if (await putBack(deps, record, rulesets, live, actor))
      back.putBack.push(record['match_id'] as string);
  }
  // The bouts put back read their copy before their write (R3).
  if (rulesets.size > 0) {
    await restampAfterInsert(deps.db, { matchId: records[0]!['match_id'] as string }, deps.logger);
  }
  return back;
}

/** Which of these records are voided. */
async function voidedAmong(db: Client, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = rowsOf(
    'The withdrawals the records hang off',
    await db
      .from('match_forfeits')
      .select('id')
      .in('id', [...new Set(ids)])
      .not('voided_at', 'is', null),
  );
  return new Set(rows.map((row) => row['id'] as string));
}

/**
 * One record voided, its bout put back. Two reasons to leave the bout alone, and the record voids
 * either way: it is in play ('running' or 'paused'), or it was fought again to a result of its own
 * (the divergence check). Its clock reopens and its sheet is read again (ruling 330). True when
 * the bout was put back.
 */
async function putBack(
  deps: BoutDeps,
  record: Row,
  rulesets: ReadonlyMap<string, MatchRulesetStamp>,
  live: Set<string>,
  actor: ForfeitVoidActor,
): Promise<boolean> {
  const matchId = record['match_id'] as string;
  const diverged = await recordedResultDiverged(deps.db, matchId, record);
  const previous = (record['previous_match_state'] as Row | null) ?? {};
  const restored = !live.has(matchId) && diverged !== true;
  if (restored) await restoreMatchState(deps.db, matchId, previous, rulesets);
  await stampForfeitVoided(deps.db, record['id'] as string, actor, true);
  if (!restored) return false;
  await reopenClockTakenBack(deps, matchId, previous);
  await readSheetAgain(deps, matchId, previous);
  return true;
}
