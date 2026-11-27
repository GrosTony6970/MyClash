/**
 * apps/api/src/modules/matches/time-limit-result.ts
 *
 * A pure decision, in its own file beside `reopen-match-columns.ts` and for the
 * same two reasons: `ClockService` is at its line budget, and a rule this
 * load-bearing is worth testing directly rather than only through the six-read
 * queue `clockAction` runs.
 */
import {
  getEffectiveBestOf,
  leadingColor,
  normalizeMatchFormatConfig,
  pendingLevelStep,
  timeIsFinished,
} from '@myclash/rulesets';
import type { LevelStep, Match, MatchFormatConfig } from '@myclash/rulesets';
import { asRow, boutRulesOf } from './bout-rules';

/** The match format a bout is being fought under, plus what dispatches it. */
export interface MatchFormatContext {
  matchFormat: MatchFormatConfig;
  phaseType: Match['phaseType'];
  matchNumberLabel: string | null;
}

/**
 * Pull the bout's match format off a `matches` row with the `phases(type)` embed and its copy of
 * its rules (`BOUT_RULES`): the format it is fought under, not its Tournament's of now.
 *
 * One reader, because the clock resolves this twice — once to decide what
 * ending does, once to apply the remedy the referee chose — and the two must
 * not disagree about which phase a medal match belongs to.
 */
export function matchFormatContext(match: Record<string, unknown>): MatchFormatContext {
  const phase = asRow(match['phases']);
  return {
    matchFormat: normalizeMatchFormatConfig(
      (boutRulesOf(match).rulesetConfig['matchFormat'] as unknown) ?? {},
    ),
    phaseType: phase?.['type'] as Match['phaseType'],
    matchNumberLabel: (match['match_number_label'] as string | null) ?? null,
  };
}

/**
 * Who is ahead on the board of a bout still in play, or null when level.
 *
 * A LIVE question, asked of the score. A running bout holds no winner (ruling 331 clears it when
 * a bout goes back in play), so "who won" has no answer yet; asking it through `winnerColorFrom`
 * only worked while that fell back to the score, which a finished bout's result must not do.
 */
function boardLeader(match: Record<string, unknown>): 'red' | 'blue' | null {
  return leadingColor({
    redScore: Number(match['red_score'] ?? 0),
    blueScore: Number(match['blue_score'] ?? 0),
  });
}

/**
 * Is a bout in play level — no recorded winner, and nobody ahead on the board?
 *
 * The winner is checked on its own, never through the score: 0-0 with a recorded winner is a
 * forfeit under a zeroing score policy, decided though it looks level (the level steps refuse it).
 */
export function isLevelBout(match: Record<string, unknown>): boolean {
  return !match['winner_registration_id'] && boardLeader(match) === null;
}

/**
 * Why the clock will not stop this bout.
 *
 * Telling them apart is the whole point: a bout still has time to run, or its
 * time is up and the phase says play a remedy. They read the same on a tablet —
 * the End button simply refuses — so each carries its own reason rather than one
 * message trying to cover both. `series_not_decided`: a best-of bout ends by its
 * rounds, never by the clock.
 */
export type EndRefusal =
  | { reason: 'time_not_finished' }
  | { reason: 'level'; step: LevelStep | null }
  | { reason: 'series_not_decided' };

/**
 * What ending the clock does to a bout: complete it with these columns, or
 * refuse and say why.
 */
export type EndOnClock = { complete: Record<string, unknown> } | { refuse: EndRefusal };

/**
 * The one owner of what ending the clock does.
 *
 * A bout that runs out of time used to complete with NO winner and NO end
 * reason, even at 3-1. That is not an edge case — it is how most pool bouts
 * finish — and eleven surfaces downstream each guessed what it had meant, five
 * different ways. Worse, `BracketAdvanceService.onMatchCompleted` returns early
 * on a null winner, so a bracket bout decided on the clock stranded its winner
 * and stalled the round with nothing to show for it.
 *
 * So the answer is recorded HERE, at the moment it is known, exactly as the
 * doubles ceiling resolves its own outcome. Every reader downstream already
 * handles a recorded winner, so they all become correct without changing — and
 * afterwards a null winner on a completed bout means exactly one thing: the
 * bout was genuinely LEVEL. That is the case the chain below decides, and a
 * level bout completed here says so: `time_limit` with no winner, a draw
 * (spec 2026-11-27-bout-result-is-stored, R2). It used to store no reason.
 *
 * A BOUT ALREADY COMPLETED IS NOT DECIDED AGAIN. A forfeit, a black card and
 * the points cap complete the bout and THEN end its clock, from inside a `catch`
 * that swallows a refusal. The End stops that clock and writes no result: a
 * zeroed forfeit row (0-0) is not refused as level, and no `time_limit` goes
 * over the reason the bout ended with. Since ruling 331 no bout back
 * in play keeps a winner, so the ladder below reads the board.
 *
 * A BEST-OF match still in play is REFUSED. `ScoringService.endRoundOnTime` owns
 * that path — it closes a ROUND, not the series, and refuses a tied one so the
 * operator plays a sudden-death point. The pad routes there and never reaches
 * this branch. A raw End used to complete the series here with no winner, on the
 * open round's score. Once the series is decided the bout is completed, and the
 * server's own End after the clinch passes through the check above it.
 *
 * Reading the match format needs no `RulesetResolver`: `bestOf`, the phase type
 * and the chain are plain config, and the `hasMaxDoubles` strip that
 * `ScoringService` applies is about the doubles ceiling, which has nothing to do
 * with the clock. That is what keeps this a leaf and avoids a provider cycle.
 *
 * A LEVEL BOUT WITH TIME LEFT IS REFUSED BEFORE THE CHAIN IS CONSULTED. The
 * chain was advisory without it: a referee could press End five seconds in, be
 * told to play a minute of extra time, take the minute, press End again and be
 * sent to sudden death — with none of that minute fought. Granting extra time
 * moves elapsed back below the limit, so this branch is also what makes the
 * granted time real. It does NOT re-test for a limit: `timeIsFinished` answers
 * true when there is none, and writing that condition twice invites a second
 * implementation that disagrees with the first.
 *
 * `levelStepsTaken` and `elapsedMs` are both REQUIRED. An optional trailing
 * input is a silent opt-out — a caller that forgets it gets today's behaviour
 * and no error, which is how a max-doubles bout kept reading as a draw on one
 * page for a day.
 */
export function timeLimitResult(
  match: Record<string, unknown>,
  levelStepsTaken: number,
  elapsedMs: number,
): EndOnClock {
  // Already completed: a forfeit, a black card or the points cap ended the bout
  // and its clock is stopped after the fact. The End decides what a LIVE bout is
  // worth, never what a finished one was: naming "the leader" here wrote
  // `time_limit` over the reason the bout really ended with. A best-of series
  // decided by its rounds is completed too, and its End passes here.
  if (match['status'] === 'completed') return { complete: {} };

  const { matchFormat, phaseType, matchNumberLabel } = matchFormatContext(match);
  const bestOf = getEffectiveBestOf({ phaseType, matchNumberLabel } as Match, matchFormat);
  if (bestOf > 1) return { refuse: { reason: 'series_not_decided' } };

  const leader = boardLeader(match);
  if (leader !== null) {
    return {
      complete: {
        winner_registration_id:
          leader === 'red' ? match['red_registration_id'] : match['blue_registration_id'],
        end_reason: 'time_limit',
      },
    };
  }

  // Level with time still to run: nothing to decide yet. Ahead of the chain, so
  // the remedies cannot be collected before the time that earns them.
  if (!timeIsFinished(elapsedMs, matchFormat, phaseType, matchNumberLabel)) {
    return { refuse: { reason: 'time_not_finished' } };
  }

  // A `draw` step means the bout may simply complete, which is today's
  // behaviour and what a pool table's D column is for: stored as `time_limit`
  // with no winner, so the result is written, not guessed. Anything else is a
  // remedy the referee has to play out first, and a spent chain (null) means
  // sudden death is already live.
  const step = pendingLevelStep(matchFormat, phaseType, matchNumberLabel, levelStepsTaken);
  if (step?.kind === 'draw') return { complete: { end_reason: 'time_limit' } };
  return { refuse: { reason: 'level', step } };
}
