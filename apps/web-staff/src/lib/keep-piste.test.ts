import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../offline/db';
import { offlineResponse } from '../offline/failure-kind';
import { keepBout, keptBout } from '../offline/kept-bout';
import { keptPiste } from '../offline/kept-piste';
import { readCached } from '../offline/cached-reads';
import { keepPisteOf } from './keep-piste';
import { catalogueKey, readPenaltyCatalogue } from './penalty-catalogue';
import { PISTE, json } from './piste-read.fixtures';

const CONFIG = { scoringConfig: { afterblowMode: 'full' }, matchFormat: { pointCap: 7 } };
const CATALOGUE = { id: 'ruleset-1', name: 'House rules' };

/** The setup reads go through the global fetch (`fetchWithCache`); the piste read is handed its own. */
function server(piste: () => Response | Promise<Response> = () => json(PISTE)) {
  const asked: string[] = [];
  const answer = (url: string) => {
    asked.push(url);
    if (url.endsWith('/bouts')) return piste();
    if (url.endsWith('/match-config')) return json(CONFIG);
    if (url.endsWith('/penalty-ruleset')) return json(CATALOGUE);
    return json({ detail: 'not stubbed' }, 404);
  };
  const fetchFn = ((url: string) => Promise.resolve(answer(url))) as typeof fetch;
  vi.stubGlobal('fetch', fetchFn);
  return { asked, fetchFn };
}

beforeEach(async () => {
  await db.reads.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-13T10:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const TEN = new Date('2026-10-13T10:00:00Z').getTime();

describe('keepPisteOf', () => {
  it('keeps every bout that has its names, with the time the piste was asked', async () => {
    const { fetchFn } = server();

    expect(await keepPisteOf('', 'lice-1', fetchFn)).toBe('piste');

    const second = await keptBout('bout-2');
    expect(second?.readAt).toBe(TEN);
    expect(second?.match).toMatchObject({ id: 'bout-2', redFighterName: 'Red bout-2' });
    expect((await keptBout('bout-1'))?.match.redScore).toBe(3);
    // No summary, no names: the bout screen does not keep such a bout either.
    expect(await keptBout('bout-3')).toBeNull();
  });

  it('keeps the order of the piste, the bout with no names included', async () => {
    const { fetchFn } = server();

    await keepPisteOf('', 'lice-1', fetchFn);

    expect(await keptPiste('lice-1')).toEqual({
      order: ['bout-1', 'bout-2', 'bout-3'],
      readAt: TEN,
    });
  });

  it('keeps the rules and the penalty catalogue of each Tournament, asked once each', async () => {
    const { asked, fetchFn } = server();

    await keepPisteOf('', 'lice-1', fetchFn);

    expect(asked).toEqual([
      '/api/v1/staff/lices/lice-1/bouts',
      '/api/v1/tournaments/tournament-1/match-config',
      '/api/v1/matches/bout-1/penalty-ruleset',
      '/api/v1/tournaments/tournament-2/match-config',
      '/api/v1/matches/bout-2/penalty-ruleset',
    ]);
    expect((await readCached('/api/v1/tournaments/tournament-2/match-config'))?.body).toEqual(
      CONFIG,
    );
    expect((await readCached(catalogueKey('tournament-2')))?.body).toEqual(CATALOGUE);
  });

  // The whole point of the catalogue's key: a bout the tablet never opened has
  // the catalogue of its Tournament when the network is gone.
  it('gives a bout never opened its catalogue with no network', async () => {
    const { fetchFn } = server();
    await keepPisteOf('', 'lice-1', fetchFn);
    vi.stubGlobal('fetch', () => Promise.resolve(offlineResponse()));

    const kept = await readPenaltyCatalogue('', 'bout-9-never-opened', 'tournament-1');

    expect(kept).toMatchObject({ body: CATALOGUE, fresh: false });
    // A bout of a Tournament the tablet holds nothing of has none.
    expect(await readPenaltyCatalogue('', 'bout-9', 'tournament-9')).toBeNull();
  });

  // The race. The piste was asked at 10:00:00; the bout screen then read bout 1
  // (a hit was taken) and kept it at 10:00:02; the piste answers at 10:00:05.
  it('does not put its older bout over a copy the bout screen wrote after the ask', async () => {
    let answer: (response: Response) => void = () => undefined;
    const { fetchFn } = server(() => new Promise<Response>((resolve) => (answer = resolve)));
    const keeping = keepPisteOf('', 'lice-1', fetchFn);

    vi.setSystemTime(new Date('2026-10-13T10:00:02Z'));
    const fromScreen = (await readFixtureBout()).match;
    await keepBout({ ...fromScreen, redScore: 4 });
    vi.setSystemTime(new Date('2026-10-13T10:00:05Z'));
    answer(json(PISTE));
    await keeping;

    expect((await keptBout('bout-1'))?.match.redScore).toBe(4);
    // The other bouts of the same answer are kept.
    expect((await keptBout('bout-2'))?.readAt).toBe(TEN);
  });

  it('replaces a copy written before the ask', async () => {
    vi.setSystemTime(new Date('2026-10-13T09:00:00Z'));
    await keepBout({ ...(await readFixtureBout()).match, redScore: 1 });
    vi.setSystemTime(new Date('2026-10-13T10:00:00Z'));
    const { fetchFn } = server();

    await keepPisteOf('', 'lice-1', fetchFn);

    expect(await keptBout('bout-1')).toMatchObject({ readAt: TEN, match: { redScore: 3 } });
  });

  it('changes nothing on the tablet when the piste is not answered', async () => {
    const answers: Array<[() => Response, string]> = [
      [() => offlineResponse(), 'unreachable'],
      [() => json({ detail: 'Event is over' }, 403), 'refused'],
      [() => json({ detail: 'boom' }, 500), 'failed'],
    ];
    for (const [answer, kind] of answers) {
      await db.reads.clear();
      const { fetchFn: good } = server();
      await keepPisteOf('', 'lice-1', good);
      const before = await db.reads.toArray();

      vi.setSystemTime(new Date('2026-10-13T11:00:00Z'));
      const { asked, fetchFn } = server(answer);
      expect(await keepPisteOf('', 'lice-1', fetchFn)).toBe(kind);

      expect(await db.reads.toArray()).toEqual(before);
      expect(asked).toEqual(['/api/v1/staff/lices/lice-1/bouts']);
      vi.setSystemTime(new Date('2026-10-13T10:00:00Z'));
    }
  });
});

/** Bout 1 of the fixture, as the tablet holds it after one read of the piste. */
async function readFixtureBout() {
  const { fetchFn } = server();
  await keepPisteOf('', 'lice-1', fetchFn);
  const kept = await keptBout('bout-1');
  await db.reads.clear();
  return kept!;
}
