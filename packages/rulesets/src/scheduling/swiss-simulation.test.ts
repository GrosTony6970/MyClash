import { describe, expect, it } from 'vitest';
import { planSwissRound, type SwissPairingMethod, type SwissPlayer } from './swiss';

/**
 * Full-tournament simulation for the Swiss pairing engine.
 *
 * The unit tests in swiss.test.ts check one round in isolation. The properties
 * that actually matter to an organiser are cumulative — nobody sits out twice,
 * nobody replays an opponent, everybody plays every round — and those can only
 * break after several rounds of feeding one plan's results into the next.
 *
 * Deterministic throughout: results come from a fixed outcome rule, not an RNG,
 * so a failure is reproducible from the test name alone.
 */

type Outcome = 'chalk' | 'upset' | 'alternating';

interface SimState {
  players: SwissPlayer[];
  rounds: Array<{
    pairs: Array<[string, string]>;
    bye: string | null;
    rematches: number;
    warnings: string[];
  }>;
}

const POINTS = { win: 3, loss: 0, bye: 3 };

function initialField(n: number): SwissPlayer[] {
  return Array.from({ length: n }, (_, i) => ({
    registrationId: `f${i + 1}`,
    points: 0,
    score: null,
    opponentIds: [],
    hadBye: false,
    rank: i + 1,
  }));
}

/** Winner of a pairing, by a fixed rule so the whole run is reproducible. */
function winnerOf(aId: string, bId: string, outcome: Outcome, round: number): string {
  if (outcome === 'chalk') return aId; // higher-ranked always wins
  if (outcome === 'upset') return bId; // lower-ranked always wins
  return round % 2 === 1 ? aId : bId;
}

/** Standings model: points descending, then the fighter's original seed. */
function rerank(players: SwissPlayer[]): SwissPlayer[] {
  const seedOf = (p: SwissPlayer) => Number(p.registrationId.slice(1));
  return [...players]
    .sort((a, b) => b.points - a.points || seedOf(a) - seedOf(b))
    .map((p, i) => ({ ...p, rank: i + 1 }));
}

function simulate(
  fighterCount: number,
  roundCount: number,
  opts: { method?: SwissPairingMethod; outcome?: Outcome } = {},
): SimState {
  const method = opts.method ?? 'fold';
  const outcome = opts.outcome ?? 'chalk';

  let players = initialField(fighterCount);
  const rounds: SimState['rounds'] = [];

  for (let round = 1; round <= roundCount; round += 1) {
    const plan = planSwissRound(players, { pairingMethod: method, grouping: { kind: 'points' } });

    const byId = new Map(players.map((p) => [p.registrationId, { ...p }]));

    for (const pairing of plan.pairings) {
      const winner = winnerOf(pairing.aId, pairing.bId, outcome, round);
      for (const id of [pairing.aId, pairing.bId]) {
        const player = byId.get(id)!;
        player.points += id === winner ? POINTS.win : POINTS.loss;
        player.opponentIds = [
          ...player.opponentIds,
          id === pairing.aId ? pairing.bId : pairing.aId,
        ];
      }
    }
    if (plan.byeRegistrationId) {
      const player = byId.get(plan.byeRegistrationId)!;
      player.points += POINTS.bye;
      player.hadBye = true;
    }

    rounds.push({
      pairs: plan.pairings.map((p) => [p.aId, p.bId] as [string, string]),
      bye: plan.byeRegistrationId,
      rematches: plan.pairings.filter((p) => p.rematch).length,
      warnings: plan.warnings.map((w) => w.code),
    });
    players = rerank([...byId.values()]);
  }

  return { players, rounds };
}

// ── Per-round invariants, checked on every run ───────────────────────────────

function expectRoundIsWellFormed(
  round: SimState['rounds'][number],
  fighterCount: number,
  label: string,
): void {
  const appearances = [...round.pairs.flat(), ...(round.bye ? [round.bye] : [])];

  expect(appearances, `${label}: every fighter appears exactly once`).toHaveLength(fighterCount);
  expect(new Set(appearances).size, `${label}: no fighter appears twice`).toBe(fighterCount);

  // A bye exists if and only if the field is odd — never two, never one too few.
  expect(round.bye === null, `${label}: bye presence must follow field parity`).toBe(
    fighterCount % 2 === 0,
  );
  expect(
    round.pairs.every(([a, b]) => a !== b),
    `${label}: nobody is paired with themselves`,
  ).toBe(true);
}

describe('Swiss simulation — 32 fighters, 5 rounds', () => {
  const FIGHTERS = 32;
  const ROUNDS = 5;

  for (const method of ['fold', 'adjacent'] as const) {
    for (const outcome of ['chalk', 'upset', 'alternating'] as const) {
      const label = `${method} / ${outcome}`;

      it(`${label}: every round pairs the whole field exactly once`, () => {
        const sim = simulate(FIGHTERS, ROUNDS, { method, outcome });
        expect(sim.rounds).toHaveLength(ROUNDS);
        sim.rounds.forEach((round, i) =>
          expectRoundIsWellFormed(round, FIGHTERS, `${label} round ${i + 1}`),
        );
      });

      it(`${label}: nobody replays an opponent across the whole tournament`, () => {
        const sim = simulate(FIGHTERS, ROUNDS, { method, outcome });
        const seen = new Set<string>();
        for (const round of sim.rounds) {
          for (const [a, b] of round.pairs) {
            const key = [a, b].sort().join('|');
            expect(seen, `${label}: ${key} played twice`).not.toContain(key);
            seen.add(key);
          }
          expect(round.rematches, `${label}: no round should force a rematch`).toBe(0);
        }
      });

      it(`${label}: every fighter plays exactly ${ROUNDS} bouts`, () => {
        const sim = simulate(FIGHTERS, ROUNDS, { method, outcome });
        for (const player of sim.players) {
          expect(player.opponentIds).toHaveLength(ROUNDS);
          expect(new Set(player.opponentIds).size).toBe(ROUNDS);
        }
      });

      it(`${label}: points reconcile with the results played`, () => {
        const sim = simulate(FIGHTERS, ROUNDS, { method, outcome });
        // Every bout awards exactly 3 points in total (no draws in this model),
        // so the field's points must equal 3 × bouts played.
        const total = sim.players.reduce((sum, p) => sum + p.points, 0);
        expect(total).toBe(POINTS.win * (FIGHTERS / 2) * ROUNDS);
        for (const player of sim.players) {
          expect(player.points % POINTS.win).toBe(0);
          expect(player.points).toBeLessThanOrEqual(POINTS.win * ROUNDS);
        }
      });

      it(`${label}: an even field never takes a bye`, () => {
        const sim = simulate(FIGHTERS, ROUNDS, { method, outcome });
        expect(sim.rounds.map((r) => r.bye)).toEqual(Array(ROUNDS).fill(null));
        expect(sim.players.every((p) => !p.hadBye)).toBe(true);
      });

      it(`${label}: raises no warnings on a clean field`, () => {
        const sim = simulate(FIGHTERS, ROUNDS, { method, outcome });
        expect(sim.rounds.flatMap((r) => r.warnings)).toEqual([]);
      });
    }
  }
});

describe('Swiss simulation — odd fields distribute byes', () => {
  // 5 rounds of 15 fighters is 5 byes; there are 15 candidates, so no fighter
  // should ever need a second one.
  it('gives 15 fighters over 5 rounds five byes, all to different people', () => {
    const sim = simulate(15, 5);
    const byes = sim.rounds.map((r) => r.bye);
    expect(byes.every((b) => b !== null)).toBe(true);
    expect(new Set(byes).size).toBe(5);
    expect(sim.players.filter((p) => p.hadBye)).toHaveLength(5);
  });

  it('still pairs everyone else exactly once in every round', () => {
    const sim = simulate(15, 5);
    sim.rounds.forEach((round, i) => expectRoundIsWellFormed(round, 15, `round ${i + 1}`));
  });

  it('reuses a bye only once the whole field has had one', () => {
    // 5 fighters, 7 rounds: byes 1-5 must be distinct, then they start over.
    const sim = simulate(5, 7);
    const byes = sim.rounds.map((r) => r.bye!);
    expect(new Set(byes.slice(0, 5)).size).toBe(5);
    expect(byes).toHaveLength(7);
  });

  it('gives the bye to a low-ranked fighter, not the leader', () => {
    const sim = simulate(15, 1, { outcome: 'chalk' });
    // Round 1 is ranked by seed, so the bye is the bottom seed.
    expect(sim.rounds[0]!.bye).toBe('f15');
  });
});

describe('Swiss simulation — small fields exhaust their opponents', () => {
  /**
   * 4 fighters can only play 3 distinct opponents each. A 4th round therefore
   * has no rematch-free pairing at all — the engine must say so and pair
   * anyway rather than throwing, because a running event cannot stall.
   */
  it('pairs a 4-fighter field for 3 rounds with no rematch', () => {
    const sim = simulate(4, 3);
    expect(sim.rounds.every((r) => r.rematches === 0)).toBe(true);
    for (const player of sim.players) {
      expect(new Set(player.opponentIds).size).toBe(3);
    }
  });

  it('forces and reports a rematch in round 4, without throwing', () => {
    const sim = simulate(4, 4);
    const last = sim.rounds[3]!;
    expect(last.rematches).toBeGreaterThan(0);
    expect(last.warnings).toContain('forced-rematch');
    expect(last.warnings).toContain('no-perfect-matching');
    // And the round is still complete and well-formed.
    expectRoundIsWellFormed(last, 4, 'round 4');
  });

  it('keeps going for several rounds past exhaustion', () => {
    const sim = simulate(4, 8);
    expect(sim.rounds).toHaveLength(8);
    sim.rounds.forEach((round, i) => expectRoundIsWellFormed(round, 4, `round ${i + 1}`));
  });
});

describe('Swiss simulation — realistic HEMA field sizes', () => {
  // The case the format exists for: 40-120 fighters on a one-day event.
  for (const n of [40, 63, 88, 120]) {
    it(`${n} fighters over 6 rounds: no rematches, no duplicate byes`, () => {
      const sim = simulate(n, 6);

      sim.rounds.forEach((round, i) => expectRoundIsWellFormed(round, n, `n=${n} round ${i + 1}`));

      const seen = new Set<string>();
      for (const round of sim.rounds) {
        for (const [a, b] of round.pairs) {
          const key = [a, b].sort().join('|');
          expect(seen, `n=${n}: ${key} played twice`).not.toContain(key);
          seen.add(key);
        }
      }

      const byes = sim.rounds.map((r) => r.bye).filter((b): b is string => b !== null);
      expect(new Set(byes).size, `n=${n}: a fighter sat out twice`).toBe(byes.length);
    });
  }

  it('is deterministic — the same field replays to the same tournament', () => {
    expect(simulate(40, 6)).toEqual(simulate(40, 6));
  });
});
