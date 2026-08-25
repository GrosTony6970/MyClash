/**
 * Aggregate per-fighter stats from a set of finished bouts, in the
 * `{ victories, ties, losses, doubleHits, hitsGiven, hitsReceived }` shape the
 * FormulaRuleset evaluates its authored score formula against.
 *
 * Pure function. No DB, no I/O.
 */
import { computeAfterblowDeltas, type AfterblowMode } from '../afterblow';
import type { Exchange, ScoredMatch } from '../domain';
import type { DerivedFighterStats } from './types';

interface MatchOutcome {
  redScore: number;
  blueScore: number;
}

/**
 * Compute a match's red/blue score from its exchanges. Mirrors the simple
 * "first-strike point + (optional) afterblow point" arithmetic used by the
 * existing pool-standings code path, ignoring per-ruleset bonuses. Afterblows
 * are netted per the tournament's afterblow mode (deductive subtracts the
 * afterblow from the attacker); exchanges store the raw button values.
 */
function computeRawScore(exchanges: Exchange[], afterblowMode: AfterblowMode): MatchOutcome {
  let red = 0;
  let blue = 0;
  for (const ex of exchanges) {
    if (ex.voided) continue;
    if (ex.type === 'double' || ex.type === 'no_exchange') continue;
    const striker = ex.firstStrikerColor;
    const firstValue = ex.firstStrikeValue ?? 0;
    const afterValue = ex.afterblowValue ?? 0;
    const { attackerDelta, defenderDelta } =
      ex.type === 'afterblow'
        ? computeAfterblowDeltas(afterblowMode, firstValue, afterValue)
        : { attackerDelta: firstValue, defenderDelta: 0 };
    if (striker === 'red') {
      red += attackerDelta;
      blue += defenderDelta;
    } else if (striker === 'blue') {
      blue += attackerDelta;
      red += defenderDelta;
    }
  }
  return { redScore: red, blueScore: blue };
}

/**
 * `completedMatches` carry their own exchanges, so there is no second `Map`
 * argument to keep in step with them — the caller used to build one by walking
 * the same array this walks. `afterblowMode` is required: it changes every
 * number below, and a parameter that defaults to 'full' while the product
 * default is 'deductive' silently scores a bout the wrong way.
 */
export function deriveFighterStats(
  registrationId: string,
  completedMatches: ScoredMatch[],
  afterblowMode: AfterblowMode,
): DerivedFighterStats {
  const stats: DerivedFighterStats = {
    victories: 0,
    ties: 0,
    losses: 0,
    doubleHits: 0,
    hitsGiven: 0,
    hitsReceived: 0,
  };

  for (const match of completedMatches) {
    const isRed = match.redRegistrationId === registrationId;
    const isBlue = match.blueRegistrationId === registrationId;
    if (!isRed && !isBlue) continue;

    const exchanges = match.exchanges;
    const { redScore, blueScore } = computeRawScore(exchanges, afterblowMode);
    const myScore = isRed ? redScore : blueScore;
    const oppScore = isRed ? blueScore : redScore;

    stats.hitsGiven += myScore;
    stats.hitsReceived += oppScore;

    for (const ex of exchanges) {
      if (!ex.voided && ex.type === 'double') stats.doubleHits += 1;
    }

    // The doubles ceiling under `double_loss_zero_scores` is a LOSS FOR BOTH,
    // and it cannot be read off the score here at all: this re-derives from the
    // RAW exchanges, so the engine's 0-0 collapse is not even visible. A bout
    // stopped at the ceiling after two red hits was scoring a VICTORY for red
    // and a loss for blue in every organiser-authored formula.
    //
    // The other two ceiling reasons need no branch: 'max_doubles_draw' is a
    // genuine draw and 'max_doubles_result_stands' keeps the board the raw
    // score already reproduces.
    if (match.endReason === 'max_doubles') stats.losses += 1;
    else if (myScore > oppScore) stats.victories += 1;
    else if (myScore < oppScore) stats.losses += 1;
    else stats.ties += 1;
  }

  return stats;
}
