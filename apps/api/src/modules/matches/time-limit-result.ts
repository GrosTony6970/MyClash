/**
 * apps/api/src/modules/matches/time-limit-result.ts
 *
 * A pure decision, in its own file beside `reopen-match-columns.ts` and for the
 * same two reasons: `ClockService` is at its line budget, and a rule this
 * load-bearing is worth testing directly rather than only through the six-read
 * queue `clockAction` runs.
 */
import { getEffectiveBestOf, leadingColor, normalizeMatchFormatConfig } from '@myclash/rulesets';
import type { Match } from '@myclash/rulesets';

/**
 * The result columns for a bout the referee has just ended on the clock.
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
 * bout was genuinely LEVEL.
 *
 * TWO CASES ARE DELIBERATELY LEFT ALONE.
 *   - A LEVEL bout. There is no winner to name; it completes as a draw, which is
 *     what a pool table's D column is for.
 *   - A BEST-OF match. `ScoringService.endRoundOnTime` owns that path — it
 *     closes a ROUND, not the series, and refuses a tied one so the operator
 *     plays a sudden-death point. The pad routes there and never reaches this
 *     branch, but the guard is not obvious from here, so it is explicit.
 *
 * Reading the match format needs no `RulesetResolver`: `bestOf` and the phase
 * type are plain config, and the `hasMaxDoubles` strip that `ScoringService`
 * applies is about the doubles ceiling, which has nothing to do with the clock.
 * That is what keeps this a leaf and avoids a provider cycle.
 */
export function timeLimitResult(match: Record<string, unknown>): Record<string, unknown> {
  const phase = asRow(match['phases']);
  const tournament = asRow(phase?.['tournaments']);
  const matchFormat = normalizeMatchFormatConfig(
    (asRow(tournament?.['ruleset_config'])?.['matchFormat'] as unknown) ?? {},
  );
  const phaseType = phase?.['type'] as Match['phaseType'];
  const bestOf = getEffectiveBestOf(
    {
      phaseType,
      matchNumberLabel: (match['match_number_label'] as string | null) ?? null,
    } as Match,
    matchFormat,
  );
  if (bestOf > 1) return {};

  const leader = leadingColor({
    redScore: Number(match['red_score'] ?? 0),
    blueScore: Number(match['blue_score'] ?? 0),
  });
  if (leader === null) return {};

  return {
    winner_registration_id:
      leader === 'red' ? match['red_registration_id'] : match['blue_registration_id'],
    end_reason: 'time_limit',
  };
}

/** A PostgREST embed arrives as an object or a one-element array. */
function asRow(value: unknown): Record<string, unknown> | null {
  const row = Array.isArray(value) ? value[0] : value;
  return row && typeof row === 'object' ? (row as Record<string, unknown>) : null;
}
