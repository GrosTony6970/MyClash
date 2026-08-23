/**
 * packages/rulesets/src/formula/derive-stats.ts
 *
 * Aggregate per-fighter stats from match + exchange data. The same data the
 * `Generic_PointsCap.computePoolStandings` engine uses, just packaged into the
 * `{ victories, ties, losses, doubleHits, hitsGiven, hitsReceived }` shape the
 * FormulaRuleset evaluates against.
 *
 * Pure function. No DB, no I/O.
 */
import { computeAfterblowDeltas, type AfterblowMode } from '../afterblow';
import type { Exchange, Match } from '../domain';
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

export function deriveFighterStats(
  registrationId: string,
  matches: Match[],
  exchangesByMatch: Map<string, Exchange[]>,
  afterblowMode: AfterblowMode = 'full',
): DerivedFighterStats {
  const stats: DerivedFighterStats = {
    victories: 0,
    ties: 0,
    losses: 0,
    doubleHits: 0,
    hitsGiven: 0,
    hitsReceived: 0,
  };

  for (const match of matches) {
    if (match.status !== 'completed') continue;
    const isRed = match.redRegistrationId === registrationId;
    const isBlue = match.blueRegistrationId === registrationId;
    if (!isRed && !isBlue) continue;

    const exchanges = exchangesByMatch.get(match.id) ?? [];
    const { redScore, blueScore } = computeRawScore(exchanges, afterblowMode);
    const myScore = isRed ? redScore : blueScore;
    const oppScore = isRed ? blueScore : redScore;

    stats.hitsGiven += myScore;
    stats.hitsReceived += oppScore;

    for (const ex of exchanges) {
      if (!ex.voided && ex.type === 'double') stats.doubleHits += 1;
    }

    if (myScore > oppScore) stats.victories += 1;
    else if (myScore < oppScore) stats.losses += 1;
    else stats.ties += 1;
  }

  return stats;
}
