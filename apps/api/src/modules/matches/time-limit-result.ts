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
  normalizeMatchFormatConfig,
  pendingLevelStep,
  timeIsFinished,
  winnerColorFrom,
} from '@myclash/rulesets';
import type { LevelStep, Match, MatchFormatConfig } from '@myclash/rulesets';

/** The match format a bout is being fought under, plus what dispatches it. */
export interface MatchFormatContext {
  matchFormat: MatchFormatConfig;
  phaseType: Match['phaseType'];
  matchNumberLabel: string | null;
}

/**
 * Pull the phase's match format off a `matches` row with the
 * `phases(type, tournaments(ruleset_config))` embed.
 *
 * One reader, because the clock resolves this twice — once to decide what
 * ending does, once to apply the remedy the referee chose — and the two must
 * not disagree about which phase a medal match belongs to.
 */
export function matchFormatContext(match: Record<string, unknown>): MatchFormatContext {
  const phase = asRow(match['phases']);
  const tournament = asRow(phase?.['tournaments']);
  return {
    matchFormat: normalizeMatchFormatConfig(
      (asRow(tournament?.['ruleset_config'])?.['matchFormat'] as unknown) ?? {},
    ),
    phaseType: phase?.['type'] as Match['phaseType'],
    matchNumberLabel: (match['match_number_label'] as string | null) ?? null,
  };
}

/** Is the bout undecided — no recorded winner and nobody ahead on the board? */
export function isLevelBout(match: Record<string, unknown>): boolean {
  return (
    winnerColorFrom({
      winnerRegistrationId: (match['winner_registration_id'] as string | null) ?? null,
      redRegistrationId: (match['red_registration_id'] as string | null) ?? null,
      blueRegistrationId: (match['blue_registration_id'] as string | null) ?? null,
      redScore: Number(match['red_score'] ?? 0),
      blueScore: Number(match['blue_score'] ?? 0),
    }) === null
  );
}

/**
 * The `adjust_time` value that puts exactly `seconds` back on a countdown.
 *
 * THE SIGN IS THE TRAP. `adjust_time` mutates ELAPSED active time, and a
 * countdown shows `limit − elapsed`, so GRANTING time is a NEGATIVE adjustment.
 * Anchoring on the display rather than applying a flat `−seconds` also handles
 * the bout that ran past zero: elapsed carries a hidden overshoot, and a flat
 * delta would give a clock that read 00:00 rather less than a minute.
 *
 * Zero only with NO PHASE LIMIT: there is nothing to extend, so extra time is an
 * instruction to the referee rather than a clock mutation.
 *
 * COUNT-UP MOVES TOO, and this used to say the opposite. `timerMode` is display
 * only — the bout ends at the limit either way — so a count-up bout that did not
 * rewind could have its End accepted the instant the extra time was granted, and
 * the minute would exist only as advice. The numeral reads 03:00 → 02:00 and
 * climbs back, which is what a minute of extra time is.
 *
 * Deliberately NOT `clock-adjustment.ts`'s `clockAdjustmentMs`, which is a ±
 * delta from the shown remaining, clamped to the limit, and lives on the pad.
 */
export function extraTimeAdjustmentMs(
  seconds: number,
  elapsedMs: number,
  limitMs: number | null,
): number {
  if (limitMs === null) return 0;
  return limitMs - seconds * 1000 - elapsedMs;
}

/**
 * Why the clock will not stop this bout.
 *
 * Two refusals, and telling them apart is the whole point: a bout still has
 * time to run, or its time is up and the phase says play a remedy. They read
 * the same on a tablet — the End button simply refuses — so each carries its
 * own reason rather than one message trying to cover both.
 */
export type EndRefusal =
  { reason: 'time_not_finished' } | { reason: 'level'; step: LevelStep | null };

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
 * bout was genuinely LEVEL. That is the case the chain below decides.
 *
 * THE DECIDED TEST IS THE LADDER, NOT THE SCORES. `winnerColorFrom` reads a
 * recorded `winner_registration_id` first, and it must: a forfeit writes the
 * winner and THEN ends the clock, and under a zeroing score policy that row is
 * 0-0. Reading the scores alone would call an already-decided bout level and
 * refuse to end its clock — inside a `catch` that swallows the refusal, so the
 * clock would simply never stop and the endcard would never fire.
 *
 * A BEST-OF match is left alone. `ScoringService.endRoundOnTime` owns that path
 * — it closes a ROUND, not the series, and refuses a tied one so the operator
 * plays a sudden-death point. The pad routes there and never reaches this
 * branch, but the guard is not obvious from here, so it is explicit.
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
  const { matchFormat, phaseType, matchNumberLabel } = matchFormatContext(match);
  const bestOf = getEffectiveBestOf({ phaseType, matchNumberLabel } as Match, matchFormat);
  if (bestOf > 1) return { complete: {} };

  if (!isLevelBout(match)) {
    const leader = winnerColorFrom({
      winnerRegistrationId: (match['winner_registration_id'] as string | null) ?? null,
      redRegistrationId: (match['red_registration_id'] as string | null) ?? null,
      blueRegistrationId: (match['blue_registration_id'] as string | null) ?? null,
      redScore: Number(match['red_score'] ?? 0),
      blueScore: Number(match['blue_score'] ?? 0),
    });
    return {
      complete: {
        winner_registration_id:
          leader === 'red' ? match['red_registration_id'] : match['blue_registration_id'],
        end_reason: 'time_limit',
      },
    };
  }

  // Level, and already completed — a forfeit or a ceiling bout whose clock is
  // being stopped after the fact. The chain decides what a LIVE bout is worth,
  // never what a finished one was.
  if (match['status'] === 'completed') return { complete: {} };

  // Level with time still to run: nothing to decide yet. Ahead of the chain, so
  // the remedies cannot be collected before the time that earns them.
  if (!timeIsFinished(elapsedMs, matchFormat, phaseType, matchNumberLabel)) {
    return { refuse: { reason: 'time_not_finished' } };
  }

  // A `draw` step means the bout may simply complete, which is today's
  // behaviour and what a pool table's D column is for. Anything else is a
  // remedy the referee has to play out first, and a spent chain (null) means
  // sudden death is already live.
  const step = pendingLevelStep(matchFormat, phaseType, matchNumberLabel, levelStepsTaken);
  if (step?.kind === 'draw') return { complete: {} };
  return { refuse: { reason: 'level', step } };
}

/** A PostgREST embed arrives as an object or a one-element array. */
function asRow(value: unknown): Record<string, unknown> | null {
  const row = Array.isArray(value) ? value[0] : value;
  return row && typeof row === 'object' ? (row as Record<string, unknown>) : null;
}
