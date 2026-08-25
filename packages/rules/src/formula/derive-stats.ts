/**
 * Aggregate per-fighter stats from a set of finished bouts, in the
 * `{ victories, ties, losses, doubleHits, hitsGiven, hitsReceived }` shape the
 * FormulaRuleset evaluates its authored score formula against.
 *
 * Pure function. No DB, no I/O.
 */
import { computeAfterblowDeltas, type AfterblowMode } from '../afterblow';
import type { Exchange, ScoredMatch } from '../domain';
import { boutOutcomes } from '../match-format';
import type { DerivedFighterStats } from './types';

interface MatchOutcome {
  redScore: number;
  blueScore: number;
}

/**
 * Sum the HITS LANDED on each side, from the exchanges alone.
 *
 * Not the bout's score, and no longer used as one. It sees no penalty, no
 * forfeit policy and no doubles-ceiling zeroing, because none of those is an
 * exchange — which is precisely why deciding the RESULT from it was wrong. The
 * bout's stored scores are on `ScoredMatch` for that.
 *
 * Afterblows are netted per the tournament's afterblow mode (deductive
 * subtracts the afterblow from the attacker); exchanges store raw button values.
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
 *
 * TWO QUESTIONS, TWO SOURCES. `hitsGiven`/`hitsReceived` are named for HITS and
 * come from the exchanges. W/D/L comes from the bout's own result, through
 * `boutOutcomes`.
 *
 * It used to compare a score RE-DERIVED from those same exchanges, so anything
 * that decided a bout other than the exchanges was invisible to it: a forfeit,
 * a referee override, a penalty that flipped the result, and the doubles
 * ceiling's zeroing. A bout stopped at the ceiling two hits up scored a VICTORY
 * for the leader. And since `victories`/`ties`/`losses` ARE this ruleset's W/D/L
 * variables, an org-authored pool derived W/D/L twice in one table, two
 * different ways.
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
    stats.hitsGiven += isRed ? redScore : blueScore;
    stats.hitsReceived += isRed ? blueScore : redScore;

    for (const ex of exchanges) {
      if (!ex.voided && ex.type === 'double') stats.doubleHits += 1;
    }

    // W / D / L, from the bout that was actually fought — see the docblock.
    const outcome = boutOutcomes({
      winnerRegistrationId: match.winnerRegistrationId,
      redRegistrationId: match.redRegistrationId,
      blueRegistrationId: match.blueRegistrationId,
      redScore: match.redScore,
      blueScore: match.blueScore,
      endReason: match.endReason,
    })[isRed ? 'red' : 'blue'];
    if (outcome === 'win') stats.victories += 1;
    else if (outcome === 'loss') stats.losses += 1;
    else stats.ties += 1;
  }

  return stats;
}
