import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from './db';
import { keepBout, keepBoutsAskedAt, keptBout } from './kept-bout';
import {
  keepPiste,
  keepPisteList,
  keptNeighbours,
  keptPiste,
  keptPisteList,
  neighboursFromPiste,
} from './kept-piste';
import type { MatchInfo } from '../components/MatchView';

const bout = (id: string, redScore = 0): MatchInfo => ({
  id,
  matchNumberLabel: 'M3',
  status: 'scheduled',
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
    await keepBout(bout('lice-1'), Date.now(), undefined);
    await keepPiste('lice-1', ['a'], 1_000);

    expect((await keptBout('lice-1'))?.match.id).toBe('lice-1');
    expect((await keptPiste('lice-1'))?.order).toEqual(['a']);
  });
});

describe('the neighbours of a bout, from the piste the tablet keeps', () => {
  const named = (id: string): MatchInfo => ({
    ...bout(id),
    matchNumberLabel: `L1-P1-${id}`,
    roundCode: `LSW-P1-${id}`,
    redFighterName: `Red ${id}`,
    blueFighterName: `Blue ${id}`,
    redClub: 'Club A',
  });
  const copies = (ids: string[]) => (id: string) => (ids.includes(id) ? named(id) : null);
  const tile = (id: string) => ({
    id,
    matchNumberLabel: `L1-P1-${id}`,
    roundCode: `LSW-P1-${id}`,
    redName: `Red ${id}`,
    blueName: `Blue ${id}`,
    redClub: 'Club A',
    blueClub: null,
  });

  it('are the bouts before and after it in the order', () => {
    expect(neighboursFromPiste(['a', 'b', 'c'], 'b', copies(['a', 'b', 'c']))).toEqual({
      previous: tile('a'),
      next: tile('c'),
    });
  });

  it('are nothing past the two ends, and nothing for a bout that is not of the piste', () => {
    const all = copies(['a', 'b', 'c']);

    expect(neighboursFromPiste(['a', 'b', 'c'], 'a', all)).toEqual({
      previous: null,
      next: tile('b'),
    });
    expect(neighboursFromPiste(['a', 'b', 'c'], 'c', all)).toEqual({
      previous: tile('b'),
      next: null,
    });
    // Not found is -1: the bout "after" it would be the first of the piste.
    expect(neighboursFromPiste(['a', 'b', 'c'], 'z', all)).toEqual({ previous: null, next: null });
    expect(neighboursFromPiste([], 'a', all)).toEqual({ previous: null, next: null });
  });

  // Stepping over it would send the table to fight bout c in place of bout b.
  it('name the next bout of the order even when the tablet holds no copy of it', () => {
    expect(neighboursFromPiste(['a', 'b', 'c'], 'a', copies(['a', 'c'])).next).toEqual({
      id: 'b',
      matchNumberLabel: null,
      roundCode: null,
      redName: '',
      blueName: '',
      redClub: null,
      blueClub: null,
    });
  });

  it('are read from the kept order and the kept bouts', async () => {
    await keepPiste('lice-1', ['a', 'b', 'c'], 1_000);
    await keepBoutsAskedAt([named('a'), named('c')], 1_000, new Map());

    expect(await keptNeighbours('lice-1', 'b')).toEqual({ previous: tile('a'), next: tile('c') });
    expect((await keptNeighbours('lice-1', 'a'))?.next?.redName).toBe('');
  });

  it('are null for a piste the tablet holds nothing of', async () => {
    await keepBoutsAskedAt([named('a')], 1_000, new Map());

    expect(await keptNeighbours('lice-9', 'a')).toBeNull();
  });
});

describe('the list of the piste page the tablet keeps', () => {
  const list = (liceName: string) => ({ liceId: 'lice-1', liceName, event: null, matches: [] });

  it('is nothing for a piste whose list the tablet never read', async () => {
    expect(await keptPisteList('lice-1')).toBeNull();
  });

  it('is the last list read, with the time of that read, per piste', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-13T09:00:00Z'));
    await keepPisteList('lice-1', list('Piste 1, at nine'));
    await keepPisteList('lice-2', list('Piste 2'));
    vi.setSystemTime(new Date('2026-10-13T10:00:00Z'));
    await keepPisteList('lice-1', list('Piste 1, at ten'));
    vi.useRealTimers();

    expect(await keptPisteList('lice-1')).toEqual({
      data: list('Piste 1, at ten'),
      readAt: new Date('2026-10-13T10:00:00Z').getTime(),
    });
    expect((await keptPisteList('lice-2'))?.data.liceName).toBe('Piste 2');
  });

  it('does not share a key with the order of the same piste', async () => {
    await keepPiste('lice-1', ['a'], 1_000);
    await keepPisteList('lice-1', list('Piste 1'));

    expect((await keptPiste('lice-1'))?.order).toEqual(['a']);
    expect((await keptPisteList('lice-1'))?.data.liceName).toBe('Piste 1');
  });
});

describe('the bouts one read of the piste gave', () => {
  it('are kept with the time of the ask, and counted', async () => {
    expect(await keepBoutsAskedAt([bout('a'), bout('b', 2)], 5_000, new Map())).toBe(2);

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
      new Map(),
    );

    expect(written).toBe(2);
    expect((await keptBout('older'))?.match.redScore).toBe(9);
    expect((await keptBout('same'))?.match.redScore).toBe(9);
    expect(await keptBout('newer')).toEqual({ match: bout('newer', 1), readAt: 5_001 });
  });

  it('write nothing for no bout', async () => {
    expect(await keepBoutsAskedAt([], 5_000, new Map())).toBe(0);
    expect(await db.reads.count()).toBe(0);
  });
});
