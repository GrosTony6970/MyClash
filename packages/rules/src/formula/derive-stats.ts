/**
 * Aggregate per-fighter stats from a set of finished bouts, in the
 * `DerivedFighterStats` shape the FormulaRuleset evaluates its authored score
 * formula against.
 *
 * Pure function. No DB, no I/O.
 */
import type { AfterblowMode } from '../afterblow';
import type { ScoredMatch } from '../domain';
import { boutOutcomes } from '../match-format';
import { computeAggregates } from '../tf_v1/score';
import type { DerivedFighterStats } from './types';

/**
 * `completedMatches` carry their own exchanges, so there is no second `Map`
 * argument to keep in step with them — the caller used to build one by walking
 * the same array this walks. `afterblowMode` is required: it changes every
 * number below, and a parameter that defaults to 'full' while the product
 * default is 'deductive' silently scores a bout the wrong way.
 *
 * TWO QUESTIONS, TWO SOURCES. `hitsGiven`, `hitsReceived` and `pointsReceived`
 * come from the exchanges. W/D/L comes from the bout's own result, through
 * `boutOutcomes`.
 *
 * All three come from TF_v1's own counter (`computeAggregates`), the one the
 * standings columns read too, so a club formula, TF_v1 and a tie-breaker see
 * the same numbers. `hitsGiven` is this fighter's points from the exchanges,
 * afterblows netted by the mode. `hitsReceived` is a COUNT of times hit.
 * `pointsReceived` is the opponent's points, which are what those hits were
 * worth (ruling 2026-11-27). None of them is the bout's score: no penalty, no
 * forfeit and no doubles-ceiling zeroing is an exchange.
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
    pointsReceived: 0,
  };

  for (const match of completedMatches) {
    const isRed = match.redRegistrationId === registrationId;
    const isBlue = match.blueRegistrationId === registrationId;
    if (!isRed && !isBlue) continue;

    // TF_v1's own counter, once per side. Its win flag is not read: W/D/L comes
    // from `boutOutcomes` below.
    const opponentId = isRed ? match.blueRegistrationId : match.redRegistrationId;
    const mine = computeAggregates(registrationId, match, match.exchanges, false, afterblowMode);
    const theirs = computeAggregates(opponentId, match, match.exchanges, false, afterblowMode);
    stats.hitsGiven += mine.targetPoints;
    stats.hitsReceived += mine.timesHit;
    stats.pointsReceived += theirs.targetPoints;
    stats.doubleHits += mine.doubles;

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
