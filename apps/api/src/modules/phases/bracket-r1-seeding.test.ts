import { describe, expect, it } from 'vitest';
import {
  buildCrossPoolSnakeRanking,
  buildR1SeedingPlan,
  diffR1SeedingPlan,
  parseSeed,
  seedingSourceKind,
} from './bracket-r1-seeding';

// Standard size-8 seed distribution as the generator emits it:
// [[1,8],[5,4],[3,6],[7,2]] (seed 1 vs 8, etc.). buildR1SeedingPlan must place
// rank K into the side labelled "seed K", NOT pair adjacent ranks.
const slots8 = [
  { id: 's1', position: 1, seedA: 1, seedB: 8 },
  { id: 's2', position: 2, seedA: 5, seedB: 4 },
  { id: 's3', position: 3, seedA: 3, seedB: 6 },
  { id: 's4', position: 4, seedA: 7, seedB: 2 },
];

const ranks = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ rank: i + 1, registrationId: `r${i + 1}` }));

describe('buildR1SeedingPlan', () => {
  it('places rank K into the slot side seeded K (standard distribution, not adjacent)', () => {
    const plan = buildR1SeedingPlan(ranks(8), slots8);
    expect(plan).toEqual([
      { slotId: 's1', registrationAId: 'r1', registrationBId: 'r8' },
      { slotId: 's2', registrationAId: 'r5', registrationBId: 'r4' },
      { slotId: 's3', registrationAId: 'r3', registrationBId: 'r6' },
      { slotId: 's4', registrationAId: 'r7', registrationBId: 'r2' },
    ]);
    // The two top seeds must NOT share a slot (the reported bug).
    const slotOf = (reg: string) =>
      plan.find((p) => p.registrationAId === reg || p.registrationBId === reg)!.slotId;
    expect(slotOf('r1')).not.toBe(slotOf('r2'));
  });

  it('seeds 4 pool winners into 4 distinct first-round matches (32-bracket ground truth)', () => {
    // Live regression: seed 1 vs 32 in M1, seed 2 vs 31 in M9 — ranks 1 & 2
    // (the colliding pool winners) must land in different slots.
    const plan = buildR1SeedingPlan(ranks(32), [
      { id: 'm1', position: 1, seedA: 1, seedB: 32 },
      { id: 'm2', position: 2, seedA: 16, seedB: 17 },
      { id: 'm9', position: 9, seedA: 2, seedB: 31 },
      { id: 'm13', position: 13, seedA: 3, seedB: 30 },
    ]);
    expect(plan).toEqual([
      { slotId: 'm1', registrationAId: 'r1', registrationBId: 'r32' },
      { slotId: 'm2', registrationAId: 'r16', registrationBId: 'r17' },
      { slotId: 'm9', registrationAId: 'r2', registrationBId: 'r31' },
      { slotId: 'm13', registrationAId: 'r3', registrationBId: 'r30' },
    ]);
  });

  it('seeds a play-in bracket: R0 seed slots filled, R1 winner-of feeders left null', () => {
    // 12 fighters → main bracket 8, 4 direct seeds (1-4), 4 play-in matches.
    // R0 sides are "seed N" (filled here); R1 feeder sides are "winner of R0Px"
    // (parseSeed -> null upstream), so they stay empty until the play-in
    // winners propagate via bracket-advance.
    const plan = buildR1SeedingPlan(ranks(12), [
      { id: 'r0p1', position: 1, seedA: 5, seedB: 12 },
      { id: 'r0p2', position: 2, seedA: 6, seedB: 11 },
      { id: 'r0p3', position: 3, seedA: 7, seedB: 10 },
      { id: 'r0p4', position: 4, seedA: 8, seedB: 9 },
      { id: 'r1p1', position: 1, seedA: 1, seedB: null }, // seedB = winner of R0P4
      { id: 'r1p2', position: 2, seedA: null, seedB: 4 }, // seedA = winner of R0P1
      { id: 'r1p3', position: 3, seedA: 3, seedB: null }, // seedB = winner of R0P2
      { id: 'r1p4', position: 4, seedA: null, seedB: 2 }, // seedA = winner of R0P3
    ]);
    expect(plan).toEqual([
      { slotId: 'r0p1', registrationAId: 'r5', registrationBId: 'r12' },
      { slotId: 'r0p2', registrationAId: 'r6', registrationBId: 'r11' },
      { slotId: 'r0p3', registrationAId: 'r7', registrationBId: 'r10' },
      { slotId: 'r0p4', registrationAId: 'r8', registrationBId: 'r9' },
      { slotId: 'r1p1', registrationAId: 'r1', registrationBId: null },
      { slotId: 'r1p2', registrationAId: null, registrationBId: 'r4' },
      { slotId: 'r1p3', registrationAId: 'r3', registrationBId: null },
      { slotId: 'r1p4', registrationAId: null, registrationBId: 'r2' },
    ]);
  });

  it('leaves a seed with no matching rank null (bye for advanceByeSlots)', () => {
    // Only 7 ranked fighters: seed 8 has no rank → that side (s1.b) is a bye.
    const plan = buildR1SeedingPlan(ranks(7), slots8);
    expect(plan[0]).toEqual({ slotId: 's1', registrationAId: 'r1', registrationBId: null });
  });

  it('treats a null-seed side (bye / play-in feeder) as empty', () => {
    const plan = buildR1SeedingPlan(ranks(4), [
      { id: 's1', position: 1, seedA: 1, seedB: null },
      { id: 's2', position: 2, seedA: null, seedB: 2 },
    ]);
    expect(plan).toEqual([
      { slotId: 's1', registrationAId: 'r1', registrationBId: null },
      { slotId: 's2', registrationAId: null, registrationBId: 'r2' },
    ]);
  });

  it('yields all-null updates when rankings are empty', () => {
    const plan = buildR1SeedingPlan([], slots8);
    expect(plan.every((p) => p.registrationAId === null && p.registrationBId === null)).toBe(true);
  });
});

describe('parseSeed', () => {
  it('parses "seed N" and rejects non-seed refs', () => {
    expect(parseSeed('seed 1')).toBe(1);
    expect(parseSeed('seed 32')).toBe(32);
    expect(parseSeed('bye')).toBeNull();
    expect(parseSeed('winner of R0P1')).toBeNull();
    expect(parseSeed('seed')).toBeNull();
    expect(parseSeed('Seed 1')).toBeNull(); // case-sensitive: generator emits lowercase
    expect(parseSeed(null)).toBeNull();
    expect(parseSeed(undefined)).toBeNull();
  });
});

describe('buildCrossPoolSnakeRanking', () => {
  it('alternates pool-order and reverse-pool-order across rounds (4 pools × top-2)', () => {
    const ranking = buildCrossPoolSnakeRanking(
      [
        {
          poolId: 'P1',
          rows: [
            { rank: 1, registrationId: 'P1-1' },
            { rank: 2, registrationId: 'P1-2' },
          ],
        },
        {
          poolId: 'P2',
          rows: [
            { rank: 1, registrationId: 'P2-1' },
            { rank: 2, registrationId: 'P2-2' },
          ],
        },
        {
          poolId: 'P3',
          rows: [
            { rank: 1, registrationId: 'P3-1' },
            { rank: 2, registrationId: 'P3-2' },
          ],
        },
        {
          poolId: 'P4',
          rows: [
            { rank: 1, registrationId: 'P4-1' },
            { rank: 2, registrationId: 'P4-2' },
          ],
        },
      ],
      2,
    );
    expect(ranking).toEqual([
      { rank: 1, registrationId: 'P1-1' },
      { rank: 2, registrationId: 'P2-1' },
      { rank: 3, registrationId: 'P3-1' },
      { rank: 4, registrationId: 'P4-1' },
      { rank: 5, registrationId: 'P4-2' },
      { rank: 6, registrationId: 'P3-2' },
      { rank: 7, registrationId: 'P2-2' },
      { rank: 8, registrationId: 'P1-2' },
    ]);
  });

  it('skips missing rows so uneven pool sizes become byes downstream', () => {
    const ranking = buildCrossPoolSnakeRanking(
      [
        {
          poolId: 'P1',
          rows: [
            { rank: 1, registrationId: 'P1-1' },
            { rank: 2, registrationId: 'P1-2' },
          ],
        },
        {
          poolId: 'P2',
          rows: [
            { rank: 1, registrationId: 'P2-1' },
            { rank: 2, registrationId: 'P2-2' },
          ],
        },
        { poolId: 'P3', rows: [{ rank: 1, registrationId: 'P3-1' }] }, // no #2
        {
          poolId: 'P4',
          rows: [
            { rank: 1, registrationId: 'P4-1' },
            { rank: 2, registrationId: 'P4-2' },
          ],
        },
      ],
      2,
    );
    // P3#2 absent → only 7 entries; ranks remain dense (1..7)
    expect(ranking).toEqual([
      { rank: 1, registrationId: 'P1-1' },
      { rank: 2, registrationId: 'P2-1' },
      { rank: 3, registrationId: 'P3-1' },
      { rank: 4, registrationId: 'P4-1' },
      { rank: 5, registrationId: 'P4-2' },
      { rank: 6, registrationId: 'P2-2' },
      { rank: 7, registrationId: 'P1-2' },
    ]);
  });

  it('takes only top-1 when topN=1 — no reversal kicks in', () => {
    const ranking = buildCrossPoolSnakeRanking(
      [
        { poolId: 'P1', rows: [{ rank: 1, registrationId: 'P1-1' }] },
        { poolId: 'P2', rows: [{ rank: 1, registrationId: 'P2-1' }] },
        { poolId: 'P3', rows: [{ rank: 1, registrationId: 'P3-1' }] },
      ],
      1,
    );
    expect(ranking).toEqual([
      { rank: 1, registrationId: 'P1-1' },
      { rank: 2, registrationId: 'P2-1' },
      { rank: 3, registrationId: 'P3-1' },
    ]);
  });
});

/**
 * Diff-on-read: is this bracket still holding the fighters the standings would
 * put in it? The two cases below are the ones that make the difference between
 * a useful warning and a banner organisers learn to ignore.
 */
describe('diffR1SeedingPlan', () => {
  const plan = [
    { slotId: 's1', registrationAId: 'r1', registrationBId: 'r8' },
    { slotId: 's2', registrationAId: 'r5', registrationBId: 'r4' },
  ];

  it('reports nothing when every seeded side still holds its fighter', () => {
    expect(
      diffR1SeedingPlan(plan, [
        { id: 's1', seedA: 1, seedB: 8, registrationAId: 'r1', registrationBId: 'r8' },
        { id: 's2', seedA: 5, seedB: 4, registrationAId: 'r5', registrationBId: 'r4' },
      ]),
    ).toEqual([]);
  });

  it('names the slot whose seeded fighter no longer matches the standings', () => {
    expect(
      diffR1SeedingPlan(plan, [
        { id: 's1', seedA: 1, seedB: 8, registrationAId: 'r1', registrationBId: 'r8' },
        // A reopened pool bout changed who finished 4th.
        { id: 's2', seedA: 5, seedB: 4, registrationAId: 'r5', registrationBId: 'r9' },
      ]),
    ).toEqual(['s2']);
  });

  it('SKIPS a side with no seed label, so a play-in bracket is not permanently stale', () => {
    // `buildR1SeedingPlan` writes null for a non-seed side, but a play-in
    // slot's side B is legitimately filled by advancement ("winner of R0Px").
    // Comparing it would report drift on every play-in bracket the moment its
    // first qualifier came through — the banner would never be off.
    expect(
      diffR1SeedingPlan(
        [{ slotId: 's1', registrationAId: 'r1', registrationBId: null }],
        [
          {
            id: 's1',
            seedA: 1,
            seedB: null,
            registrationAId: 'r1',
            registrationBId: 'winner-of-play-in',
          },
        ],
      ),
    ).toEqual([]);
  });

  it('reports a seeded side the plan would now empty', () => {
    // Fewer ranked fighters than bracket size: the fighter sitting there is one
    // the standings no longer place at all.
    expect(
      diffR1SeedingPlan(
        [{ slotId: 's1', registrationAId: 'r1', registrationBId: null }],
        [{ id: 's1', seedA: 1, seedB: 8, registrationAId: 'r1', registrationBId: 'r8' }],
      ),
    ).toEqual(['s1']);
  });

  it('ignores a planned slot the bracket no longer has', () => {
    expect(diffR1SeedingPlan(plan, [])).toEqual([]);
  });
});

describe('seedingSourceKind', () => {
  it('treats ONLY pool and Swiss standings as result-derived', () => {
    // The trap: `by-rating` and `random` re-order the whole draw whenever
    // anyone withdraws or a rating refreshes, so a correctly-seeded bracket
    // would diff against them and the banner would cry wolf on every roster
    // edit. They must report `static` even with pools present.
    expect(seedingSourceKind('by-rating', true)).toBe('static');
    expect(seedingSourceKind('random', true)).toBe('static');
    expect(seedingSourceKind('by-swiss-rank', false)).toBe('swiss');
    expect(seedingSourceKind('snake', true)).toBe('pool');
    expect(seedingSourceKind('by-pool-rank', true)).toBe('pool');
  });

  it('reports static when there is no pool standings source to fall back on', () => {
    // `populateBracket` sends every non-rating, non-random, non-Swiss strategy
    // down the registration-seed path when there is no pool phase — and
    // registration seed reshuffles on any withdrawal too.
    expect(seedingSourceKind('snake', false)).toBe('static');
    expect(seedingSourceKind('by-pool-rank', false)).toBe('static');
  });
});
