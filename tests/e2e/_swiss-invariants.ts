import { expect } from '@playwright/test';
import { POINT_CAP } from './_bracket';
import type { SwissRounds } from './_swiss';

/**
 * What a played Swiss phase owes, checked INDEPENDENTLY of the server.
 *
 * Split from `_swiss.ts` so the driver (which talks to the API) and the rules
 * (which do not) stay separable — and because a checker that shares a file with
 * the thing it checks tends to start borrowing its assumptions.
 */

// ── Invariant checks ─────────────────────────────────────────────────────────

export interface SwissViolation {
  round: number;
  detail: string;
}

/**
 * Every structural rule a Swiss phase owes, checked against the played rounds.
 *
 * Returns violations rather than asserting, so a spec can report them all at
 * once — a pairing bug usually breaks the same rule in several rounds and one
 * failed assertion per run makes that take four runs to see.
 */
export function swissViolations(swiss: SwissRounds, entrantCount: number): SwissViolation[] {
  const violations: SwissViolation[] = [];
  const seen = new Map<string, Set<string>>();
  const byeCount = new Map<string, number>();

  for (const round of swiss.rounds) {
    const appearances = new Map<string, number>();
    const note = (id: string | null) => {
      if (!id) return;
      appearances.set(id, (appearances.get(id) ?? 0) + 1);
    };

    for (const match of round.matches) {
      note(match.redRegistrationId);
      note(match.blueRegistrationId);

      const red = match.redRegistrationId;
      const blue = match.blueRegistrationId;
      if (!red || !blue) {
        violations.push({ round: round.roundNumber, detail: `bout ${match.id} has an empty side` });
        continue;
      }
      // A rematch is legal ONLY when the engine says no legal alternative
      // existed — and it says so publicly, which is decision 16's whole point.
      const forced = round.warnings.some(
        (warning) =>
          warning.code === 'forced-rematch' &&
          warning.registrationIds.includes(red) &&
          warning.registrationIds.includes(blue),
      );
      if (!forced && seen.get(red)?.has(blue)) {
        violations.push({
          round: round.roundNumber,
          detail: `unflagged rematch: ${match.redFighterName} vs ${match.blueFighterName}`,
        });
      }
      if (!seen.has(red)) seen.set(red, new Set());
      if (!seen.has(blue)) seen.set(blue, new Set());
      seen.get(red)!.add(blue);
      seen.get(blue)!.add(red);
    }

    note(round.byeRegistrationId);
    if (round.byeRegistrationId) {
      byeCount.set(round.byeRegistrationId, (byeCount.get(round.byeRegistrationId) ?? 0) + 1);
    }

    const twice = [...appearances.entries()].filter(([, count]) => count > 1);
    if (twice.length > 0) {
      violations.push({
        round: round.roundNumber,
        detail: `fighter(s) appear more than once: ${twice.map(([id]) => id).join(', ')}`,
      });
    }
    // An odd field gets exactly one bye; an even field gets none.
    const expectedByes = entrantCount % 2 === 1 ? 1 : 0;
    const actualByes = round.byeRegistrationId ? 1 : 0;
    if (actualByes !== expectedByes) {
      violations.push({
        round: round.roundNumber,
        detail: `expected ${expectedByes} bye for a field of ${entrantCount}, got ${actualByes}`,
      });
    }
    if (appearances.size !== entrantCount) {
      violations.push({
        round: round.roundNumber,
        detail: `${appearances.size} of ${entrantCount} entrants were dealt into the round`,
      });
    }
  }

  // Nobody sits out twice while someone else has never sat out. Only checkable
  // once the phase is short enough that the bye pool has not been exhausted.
  if (swiss.rounds.length <= entrantCount) {
    for (const [registrationId, count] of byeCount) {
      if (count > 1) {
        violations.push({ round: 0, detail: `${registrationId} took ${count} byes` });
      }
    }
  }
  return violations;
}

/**
 * Buchholz recomputed from the rounds, independently of the server.
 *
 * The point of checking it here rather than trusting the standings: Buchholz is
 * the sum of every OPPONENT's Swiss points, so it is the one column that cannot
 * be right by accident — it only agrees if the opponent lists and the points
 * arithmetic are both right.
 *
 * A bye contributes 0, deliberately (FIDE's virtual-opponent rule is a
 * documented v1 omission), so this mirrors that and does not "fix" it.
 */
export function expectedBuchholz(
  swiss: SwissRounds,
  points: { win: number; draw: number; loss: number; bye: number },
): { swissPts: Map<string, number>; buchholz: Map<string, number> } {
  const swissPts = new Map<string, number>();
  const opponents = new Map<string, string[]>();
  const add = (id: string, value: number) => swissPts.set(id, (swissPts.get(id) ?? 0) + value);

  for (const round of swiss.rounds) {
    if (round.byeRegistrationId) add(round.byeRegistrationId, points.bye);
    for (const match of round.matches) {
      const red = match.redRegistrationId;
      const blue = match.blueRegistrationId;
      if (!red || !blue || match.status !== 'completed') continue;
      opponents.set(red, [...(opponents.get(red) ?? []), blue]);
      opponents.set(blue, [...(opponents.get(blue) ?? []), red]);
      if (match.winnerRegistrationId === null) {
        add(red, points.draw);
        add(blue, points.draw);
        continue;
      }
      const winner = match.winnerRegistrationId;
      add(winner, points.win);
      add(winner === red ? blue : red, points.loss);
    }
  }

  const buchholz = new Map<string, number>();
  for (const [id, faced] of opponents) {
    buchholz.set(
      id,
      faced.reduce((total, opponentId) => total + (swissPts.get(opponentId) ?? 0), 0),
    );
  }
  return { swissPts, buchholz };
}

/**
 * Every completed bout ended on the point cap, with a winner.
 *
 * This is what separates "the test decided" from "the ENGINE decided": the
 * driver only ever posts exchanges, so a winner sitting exactly on the cap means
 * `first_to_points` fired. A bout completed with a NULL winner (both sides at the
 * cap) can never close its round, so the phase would stall — and this catches it
 * at the bout rather than four rounds later as a missing-round timeout.
 */
export function expectEngineDecided(swiss: SwissRounds): void {
  for (const round of swiss.rounds) {
    for (const match of round.matches) {
      expect(match.status, `${match.matchNumberLabel} did not complete`).toBe('completed');
      expect(
        match.winnerRegistrationId,
        `${match.matchNumberLabel} completed with no winner`,
      ).not.toBeNull();
      const winnerScore =
        match.winnerRegistrationId === match.redRegistrationId ? match.redScore : match.blueScore;
      expect(winnerScore, `${match.matchNumberLabel} winner did not reach the cap`).toBe(POINT_CAP);
    }
  }
}
