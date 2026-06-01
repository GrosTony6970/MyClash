import { describe, expect, it } from 'vitest';
import { buildCrossPoolSnakeRanking, buildR1SeedingPlan } from './bracket-r1-seeding';

describe('buildR1SeedingPlan', () => {
  it('pairs (2P-1, 2P) ranks into each slot — 8 ranks → 4 slots', () => {
    const plan = buildR1SeedingPlan(
      [
        { rank: 1, registrationId: 'r1' },
        { rank: 2, registrationId: 'r2' },
        { rank: 3, registrationId: 'r3' },
        { rank: 4, registrationId: 'r4' },
        { rank: 5, registrationId: 'r5' },
        { rank: 6, registrationId: 'r6' },
        { rank: 7, registrationId: 'r7' },
        { rank: 8, registrationId: 'r8' },
      ],
      [
        { id: 's1', position: 1 },
        { id: 's2', position: 2 },
        { id: 's3', position: 3 },
        { id: 's4', position: 4 },
      ],
    );
    expect(plan).toEqual([
      { slotId: 's1', registrationAId: 'r1', registrationBId: 'r2' },
      { slotId: 's2', registrationAId: 'r3', registrationBId: 'r4' },
      { slotId: 's3', registrationAId: 'r5', registrationBId: 'r6' },
      { slotId: 's4', registrationAId: 'r7', registrationBId: 'r8' },
    ]);
  });

  it('leaves the missing-rank seat null so advanceByeSlots can handle it', () => {
    const plan = buildR1SeedingPlan(
      [
        { rank: 1, registrationId: 'r1' },
        { rank: 2, registrationId: 'r2' },
        { rank: 3, registrationId: 'r3' },
        { rank: 4, registrationId: 'r4' },
        { rank: 5, registrationId: 'r5' },
        { rank: 6, registrationId: 'r6' },
        { rank: 7, registrationId: 'r7' },
      ],
      [
        { id: 's1', position: 1 },
        { id: 's2', position: 2 },
        { id: 's3', position: 3 },
        { id: 's4', position: 4 },
      ],
    );
    expect(plan[3]).toEqual({ slotId: 's4', registrationAId: 'r7', registrationBId: null });
  });

  it('yields all-null updates when rankings are empty', () => {
    const plan = buildR1SeedingPlan(
      [],
      [
        { id: 's1', position: 1 },
        { id: 's2', position: 2 },
      ],
    );
    expect(plan).toEqual([
      { slotId: 's1', registrationAId: null, registrationBId: null },
      { slotId: 's2', registrationAId: null, registrationBId: null },
    ]);
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
