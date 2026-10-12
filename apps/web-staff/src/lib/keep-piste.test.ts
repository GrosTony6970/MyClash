import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../offline/db';
import { offlineResponse } from '../offline/failure-kind';
import { keepBout, keepClock, keptBout } from '../offline/kept-bout';
import { keptPiste } from '../offline/kept-piste';
import { readCached } from '../offline/cached-reads';
import type { ClockState } from '../components/scoreboard-clock';
import { keepPisteOf } from './keep-piste';
import { catalogueKey, readPenaltyCatalogue } from './penalty-catalogue';
import { readPiste } from './piste-read';
import { PISTE, json } from './piste-read.fixtures';

const CONFIG = { scoringConfig: { afterblowMode: 'full' }, matchFormat: { pointCap: 7 } };
const CATALOGUE = { id: 'ruleset-1', name: 'House rules' };
const CLOCK = { status: 'halted' } as unknown as ClockState;

type Answer = () => Response | Promise<Response>;
interface Answers {
  piste?: Answer;
  /** The answer to the rules of a Tournament, by its id. */
  config?: (tournamentId: string) => Response;
}

/** The setup reads go through the global fetch (`fetchWithCache`); the piste read is handed its own. */
function server(answers: Answers = {}) {
  const asked: string[] = [];
  const answer = (url: string) => {
    asked.push(url);
    if (url.endsWith('/bouts')) return (answers.piste ?? (() => json(PISTE)))();
    if (url.endsWith('/match-config')) {
      return answers.config?.(url.split('/').at(-2)!) ?? json(CONFIG);
    }
    if (url.endsWith('/penalty-ruleset')) return json(CATALOGUE);
    return json({ detail: 'not stubbed' }, 404);
  };
  const fetchFn = ((url: string) => Promise.resolve(answer(url))) as typeof fetch;
  vi.stubGlobal('fetch', fetchFn);
  return { asked, fetchFn };
}

/** Bout 1 of the fixture (running), as the bout screen holds it. */
async function boutOne() {
  const read = await readPiste('', 'lice-1', (() => Promise.resolve(json(PISTE))) as typeof fetch);
  if (read.kind !== 'piste') throw new Error('the fixture is no piste');
  return read.bouts[0]!.match;
}

const at = (time: string) => new Date(`2026-10-13T${time}Z`).getTime();
const TEN = at('10:00:00');

beforeEach(async () => {
  await db.reads.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(TEN);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('keepPisteOf: which bouts are kept', () => {
  it('keeps a bout not started that has its names, with the time the piste was asked', async () => {
    const { fetchFn } = server();

    expect(await keepPisteOf('', 'lice-1', fetchFn)).toBe('piste');

    const second = await keptBout('bout-2');
    expect(second?.readAt).toBe(TEN);
    expect(second?.match).toMatchObject({ id: 'bout-2', redFighterName: 'Red bout-2' });
    // No summary, no names: the bout screen does not keep such a bout either.
    expect(await keptBout('bout-3')).toBeNull();
  });

  // Bout 1 is running. Read ahead it has no clock and no hits: it would open
  // at 0:00 with Start, and no double counted, over a bout in play elsewhere.
  it('does not keep a bout in play that this tablet never opened', async () => {
    const { fetchFn } = server();

    await keepPisteOf('', 'lice-1', fetchFn);

    expect(await keptBout('bout-1')).toBeNull();
  });

  it('keeps a bout in play whose clock the tablet holds: its own screen opened it', async () => {
    await keepClock('bout-1', CLOCK);
    const { fetchFn } = server();

    await keepPisteOf('', 'lice-1', fetchFn);

    expect((await keptBout('bout-1'))?.match).toMatchObject({ status: 'running', redScore: 3 });
  });

  // The copy would open with the default buttons and say nothing: a +2 tapped
  // where the Tournament says +3 is stored as a 2.
  it('does not keep a bout whose Tournament’s rules the tablet does not hold', async () => {
    await keepClock('bout-1', CLOCK);
    const { fetchFn } = server({
      config: (id) => (id === 'tournament-2' ? offlineResponse() : json(CONFIG)),
    });

    expect(await keepPisteOf('', 'lice-1', fetchFn)).toBe('piste');

    expect(await keptBout('bout-2')).toBeNull();
    // The other Tournament's bout is kept, and the order is whole.
    expect(await keptBout('bout-1')).not.toBeNull();
    expect((await keptPiste('lice-1'))?.order).toEqual(['bout-1', 'bout-2', 'bout-3']);
  });

  it('keeps it when the rules were kept at an earlier read and cannot be read now', async () => {
    const { fetchFn: first } = server();
    await keepPisteOf('', 'lice-1', first);
    await db.reads.delete('bout/bout-2');
    const { fetchFn } = server({ config: () => json({ detail: 'boom' }, 500) });

    await keepPisteOf('', 'lice-1', fetchFn);

    expect(await keptBout('bout-2')).not.toBeNull();
  });
});

describe('keepPisteOf: what else is kept', () => {
  it('keeps the order of the piste, the bouts it did not keep included', async () => {
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

  it('changes nothing on the tablet when the piste is not answered', async () => {
    const answers: Array<[() => Response, string]> = [
      [() => offlineResponse(), 'unreachable'],
      [() => json({ detail: 'Event is over' }, 403), 'refused'],
      [() => json({ detail: 'boom' }, 500), 'failed'],
    ];
    for (const [piste, kind] of answers) {
      await db.reads.clear();
      vi.setSystemTime(TEN);
      const { fetchFn: good } = server();
      await keepPisteOf('', 'lice-1', good);
      const before = await db.reads.toArray();

      vi.setSystemTime(at('11:00:00'));
      const { asked, fetchFn } = server({ piste });
      expect(await keepPisteOf('', 'lice-1', fetchFn)).toBe(kind);

      expect(await db.reads.toArray()).toEqual(before);
      expect(asked).toEqual(['/api/v1/staff/lices/lice-1/bouts']);
    }
  });
});

describe('keepPisteOf and the bout screen’s own read of a bout', () => {
  // The piste was asked at 10:00:00. The bout screen then asked bout 1 again at
  // 10:00:02 (a hit was taken: red has 4) and kept it. The piste answers at
  // 10:00:05 with red at 3.
  it('does not put its older bout over the copy of a later ask', async () => {
    await keepClock('bout-1', CLOCK);
    let answer: (response: Response) => void = () => undefined;
    const { fetchFn } = server({
      piste: () => new Promise<Response>((resolve) => (answer = resolve)),
    });
    const keeping = keepPisteOf('', 'lice-1', fetchFn);

    await keepBout({ ...(await boutOne()), redScore: 4 }, at('10:00:02'));
    vi.setSystemTime(at('10:00:05'));
    answer(json(PISTE));
    await keeping;

    expect((await keptBout('bout-1'))?.match.redScore).toBe(4);
    // The other bouts of the same answer are kept.
    expect((await keptBout('bout-2'))?.readAt).toBe(TEN);
  });

  // The mirror: the screen asked at 09:59:58, and its slow answer (red at 2)
  // lands after the piste's, asked at 10:00:00 (red at 3).
  it('keeps its bout when the screen’s answer to an earlier ask lands last', async () => {
    await keepClock('bout-1', CLOCK);
    const { fetchFn } = server();
    await keepPisteOf('', 'lice-1', fetchFn);

    vi.setSystemTime(at('10:00:06'));
    await keepBout({ ...(await boutOne()), redScore: 2 }, at('09:59:58'));

    expect(await keptBout('bout-1')).toMatchObject({ readAt: TEN, match: { redScore: 3 } });
  });

  it('replaces a copy of an earlier ask', async () => {
    await keepClock('bout-1', CLOCK);
    await keepBout({ ...(await boutOne()), redScore: 1 }, at('09:00:00'));
    const { fetchFn } = server();

    await keepPisteOf('', 'lice-1', fetchFn);

    expect(await keptBout('bout-1')).toMatchObject({ readAt: TEN, match: { redScore: 3 } });
  });
});
