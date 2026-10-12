import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { keepBout, keepBoutsAskedAt, keptBout } from './kept-bout';
import { keepPiste, keptPiste } from './kept-piste';
import type { MatchInfo } from '../components/MatchView';

const bout = (id: string, redScore = 0): MatchInfo => ({
  id,
  matchNumberLabel: 'M3',
  status: 'scheduled',
  rulesetCode: 'TF',
  rulesetVersion: '1.0.0',
  redRegistrationId: 'red-1',
  blueRegistrationId: 'blue-1',
  redScore,
  blueScore: 0,
  redFighterName: 'Ana Red',
  blueFighterName: 'Bo Blue',
});

beforeEach(async () => {
  await db.reads.clear();
});

describe('the order of a piste the tablet keeps', () => {
  it('is nothing for a piste the tablet never read', async () => {
    expect(await keptPiste('lice-1')).toBeNull();
  });

  it('is the order of the last read, with the time it was asked, per piste', async () => {
    await keepPiste('lice-1', ['a', 'b'], 1_000);
    await keepPiste('lice-2', ['z'], 1_500);
    await keepPiste('lice-1', ['a', 'c', 'b'], 2_000);

    expect(await keptPiste('lice-1')).toEqual({ order: ['a', 'c', 'b'], readAt: 2_000 });
    expect(await keptPiste('lice-2')).toEqual({ order: ['z'], readAt: 1_500 });
  });

  // The piste list and a bout screen both ask. The answer of the earlier ask
  // can land last.
  it('is not replaced by the answer of an earlier ask', async () => {
    await keepPiste('lice-1', ['a', 'c', 'b'], 2_000);
    await keepPiste('lice-1', ['a', 'b'], 1_000);

    expect(await keptPiste('lice-1')).toEqual({ order: ['a', 'c', 'b'], readAt: 2_000 });
  });

  it('does not share a key with a bout of the same id', async () => {
    await keepBout(bout('lice-1'));
    await keepPiste('lice-1', ['a'], 1_000);

    expect((await keptBout('lice-1'))?.match.id).toBe('lice-1');
    expect((await keptPiste('lice-1'))?.order).toEqual(['a']);
  });
});

describe('the bouts one read of the piste gave', () => {
  it('are kept with the time of the ask, and counted', async () => {
    expect(await keepBoutsAskedAt([bout('a'), bout('b', 2)], 5_000)).toBe(2);

    expect(await keptBout('b')).toEqual({ match: bout('b', 2), readAt: 5_000 });
  });

  it('replace a copy as old as the ask, and leave one written after it', async () => {
    await db.reads.bulkPut([
      { path: 'bout/older', body: bout('older', 1), fetchedAt: 4_000 },
      { path: 'bout/same', body: bout('same', 1), fetchedAt: 5_000 },
      { path: 'bout/newer', body: bout('newer', 1), fetchedAt: 5_001 },
    ]);

    const written = await keepBoutsAskedAt(
      [bout('older', 9), bout('same', 9), bout('newer', 9)],
      5_000,
    );

    expect(written).toBe(2);
    expect((await keptBout('older'))?.match.redScore).toBe(9);
    expect((await keptBout('same'))?.match.redScore).toBe(9);
    expect(await keptBout('newer')).toEqual({ match: bout('newer', 1), readAt: 5_001 });
  });

  it('write nothing for no bout', async () => {
    expect(await keepBoutsAskedAt([], 5_000)).toBe(0);
    expect(await db.reads.count()).toBe(0);
  });
});
