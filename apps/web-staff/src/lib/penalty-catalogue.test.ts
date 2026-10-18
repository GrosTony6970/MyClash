import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../offline/db';
import { readCached, writeCached } from '../offline/cached-reads';
import { offlineResponse } from '../offline/failure-kind';
import { cardCatalogueKey, catalogueKey, readPenaltyCatalogue } from './penalty-catalogue';
import { json } from './piste-read.fixtures';

const CARDS_A = { id: 'cards-a', name: 'House rules', built_in: false };
const BUILT_IN = { id: 'cards-0', name: 'Federal', built_in: true };
const PATH = '/api/v1/matches/bout-1/penalty-ruleset';

const answering = (body: unknown) => vi.stubGlobal('fetch', () => Promise.resolve(json(body)));
const offline = () => vi.stubGlobal('fetch', () => Promise.resolve(offlineResponse()));
const held = async (key: string) => (await readCached(key))?.body ?? null;

beforeEach(async () => {
  await db.reads.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('readPenaltyCatalogue: what an answer is kept under', () => {
  it('keeps a catalogue under the card ruleset it is, and as its Tournament’s last', async () => {
    answering(CARDS_A);

    const read = await readPenaltyCatalogue('', 'bout-1', { tournamentId: 'tournament-1' });

    expect(read).toMatchObject({ body: CARDS_A, fresh: true });
    expect(await held(cardCatalogueKey('cards-a'))).toEqual(CARDS_A);
    expect(await held(catalogueKey('tournament-1'))).toEqual(CARDS_A);
    expect(await held(cardCatalogueKey(null))).toBeNull();
  });

  // A copy that pins none reads as the built-in: it asks `card/built-in`.
  it('keeps the built-in under its id and as the built-in', async () => {
    answering(BUILT_IN);

    await readPenaltyCatalogue('', 'bout-1', { tournamentId: 'tournament-1' });

    expect(await held(cardCatalogueKey('cards-0'))).toEqual(BUILT_IN);
    expect(await held(cardCatalogueKey(null))).toEqual(BUILT_IN);
  });

  // The key is the answer's, not the bout read's: the bout said card rules A,
  // the organiser switched to B between the two requests, the answer is B.
  it('keeps the answer under its own card ruleset, whatever the bout named', async () => {
    answering({ ...CARDS_A, id: 'cards-b' });

    await readPenaltyCatalogue('', 'bout-1', { cardKey: cardCatalogueKey('cards-a') });

    expect(await held(cardCatalogueKey('cards-a'))).toBeNull();
    expect(await held(cardCatalogueKey('cards-b'))).toMatchObject({ id: 'cards-b' });
  });

  it('keeps an answer of no ruleset as the Tournament’s last only, and does not throw', async () => {
    answering(null);

    const read = await readPenaltyCatalogue('', 'bout-1', { tournamentId: 'tournament-1' });

    expect(read).toMatchObject({ body: null, fresh: true });
    expect(await db.reads.count()).toBe(1);
    expect(await readCached(catalogueKey('tournament-1'))).toMatchObject({ body: null });
  });

  // A bout read without its summary names no Tournament: kept by its own path, as it was.
  it('keeps the catalogue of a bout of no Tournament under the bout’s own path', async () => {
    answering(CARDS_A);

    await readPenaltyCatalogue('', 'bout-1', {});

    expect(await held(PATH)).toEqual(CARDS_A);
  });
});

describe('readPenaltyCatalogue with no network', () => {
  it('reads the catalogue of the bout’s own card rules first', async () => {
    await writeCached(cardCatalogueKey('cards-a'), CARDS_A);
    await writeCached(catalogueKey('tournament-1'), BUILT_IN);
    offline();

    const read = await readPenaltyCatalogue('', 'bout-1', {
      cardKey: cardCatalogueKey('cards-a'),
      tournamentId: 'tournament-1',
    });

    expect(read).toMatchObject({ body: CARDS_A, fresh: false });
  });

  // Ruling J: the Tournament's bouts' catalogue, last seen.
  it('reads its Tournament’s last when its card rules were never read, or it has no rules', async () => {
    await writeCached(catalogueKey('tournament-1'), BUILT_IN);
    offline();

    for (const cardKey of [cardCatalogueKey('cards-z'), null]) {
      const read = await readPenaltyCatalogue('', 'bout-1', {
        cardKey,
        tournamentId: 'tournament-1',
      });
      expect(read).toMatchObject({ body: BUILT_IN, fresh: false });
    }
  });

  it('reads the bout’s own path for a bout of no Tournament, and nothing when none is held', async () => {
    offline();
    expect(await readPenaltyCatalogue('', 'bout-1', {})).toBeNull();

    await writeCached(PATH, CARDS_A);
    expect(await readPenaltyCatalogue('', 'bout-1', {})).toMatchObject({ body: CARDS_A });
  });

  it('falls back on a fault of the server and on no answer at all, as on no network', async () => {
    await writeCached(cardCatalogueKey('cards-a'), CARDS_A);
    const keys = { cardKey: cardCatalogueKey('cards-a') };
    vi.stubGlobal('fetch', () => Promise.resolve(json({ detail: 'boom' }, 500)));
    expect(await readPenaltyCatalogue('', 'bout-1', keys)).toMatchObject({ fresh: false });
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')));
    expect(await readPenaltyCatalogue('', 'bout-1', keys)).toMatchObject({ fresh: false });
  });
});
