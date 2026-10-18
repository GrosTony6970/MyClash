import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../offline/db';
import { offlineResponse } from '../offline/failure-kind';
import { keepBout, keepClock, keptBout } from '../offline/kept-bout';
import { keptPiste } from '../offline/kept-piste';
import { readCached } from '../offline/cached-reads';
import type { ClockState } from '../components/scoreboard-clock';
import { keepPisteOf } from './keep-piste';
import { cardCatalogueKey, catalogueKey, readPenaltyCatalogue } from './penalty-catalogue';
import { readPiste } from './piste-read';
import { PISTE, json, row, rulesOf, summary } from './piste-read.fixtures';

const CONFIG = { scoringConfig: { afterblowMode: 'full' }, matchFormat: { pointCap: 7 } };
/** The catalogue a bout's card rules give: bout 2 pins card rules B, the others A (the fixture). */
const catalogueOf = (matchId: string) =>
  matchId === 'bout-2' ? { id: 'cards-b', name: 'Club rules' } : { id: 'cards-a', name: 'House' };
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
    if (url.endsWith('/penalty-ruleset')) return json(catalogueOf(url.split('/').at(-2)!));
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
  return read.bouts[0]!;
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
  vi.restoreAllMocks();
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

  // Ruling K: a bout's rules ride on its read. One read without them (a server
  // fault) would open on its Tournament's rules of now, not the bout's own.
  it('does not keep a bout read without its own rules', async () => {
    const { rules: _rules, ...bare } = PISTE.bouts[1]!.match;
    const piste = { ...PISTE, bouts: [PISTE.bouts[0]!, { ...PISTE.bouts[1]!, match: bare }] };
    const { fetchFn } = server({ piste: () => json(piste) });

    expect(await keepPisteOf('', 'lice-1', fetchFn)).toBe('piste');

    expect(await keptBout('bout-2')).toBeNull();
  });

  // The side colours tell the referee which side to tap: a copy with the
  // default colours over the Tournament's own is a hit given to the wrong side.
  it('does not keep a bout whose Tournament’s display the tablet does not hold', async () => {
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

  // Bouts 1 and 3 pin card rules A, bout 2 card rules B: one catalogue read
  // each, by the first bout naming it. Bout 3 is of no Tournament: no config.
  it('keeps the config of each Tournament and the catalogue of each card ruleset, asked once each', async () => {
    const { asked, fetchFn } = server();

    await keepPisteOf('', 'lice-1', fetchFn);

    expect(asked).toEqual([
      '/api/v1/staff/lices/lice-1/bouts',
      '/api/v1/tournaments/tournament-1/match-config',
      '/api/v1/tournaments/tournament-2/match-config',
      '/api/v1/matches/bout-1/penalty-ruleset',
      '/api/v1/matches/bout-2/penalty-ruleset',
    ]);
    expect((await readCached('/api/v1/tournaments/tournament-2/match-config'))?.body).toEqual(
      CONFIG,
    );
    expect((await readCached(cardCatalogueKey('cards-b')))?.body).toEqual(catalogueOf('bout-2'));
    expect((await readCached(catalogueKey('tournament-2')))?.body).toEqual(catalogueOf('bout-2'));
  });

  // Two copies of ONE Tournament pin two card rulesets: two reads. One card
  // ruleset across two Tournaments: one read.
  it('asks one catalogue per card ruleset its bouts name, whatever their Tournaments', async () => {
    const bout = (id: string, cards: string, tournamentId: string) => ({
      match: row(id, { rules: rulesOf(cards) }),
      summary: summary(id, tournamentId),
    });
    const piste = {
      ...PISTE,
      bouts: [
        bout('one', 'cards-a', 'tournament-1'),
        bout('two', 'cards-b', 'tournament-1'),
        bout('three', 'cards-a', 'tournament-2'),
      ],
    };
    const { asked, fetchFn } = server({ piste: () => json(piste) });

    await keepPisteOf('', 'lice-1', fetchFn);

    expect(asked.filter((url) => url.endsWith('/penalty-ruleset'))).toEqual([
      '/api/v1/matches/one/penalty-ruleset',
      '/api/v1/matches/two/penalty-ruleset',
    ]);
  });

  // The whole point of the catalogue's key: a bout the tablet never opened has
  // the catalogue of its own card rules when the network is gone.
  it('gives a bout never opened its catalogue with no network', async () => {
    const { fetchFn } = server();
    await keepPisteOf('', 'lice-1', fetchFn);
    vi.stubGlobal('fetch', () => Promise.resolve(offlineResponse()));

    const kept = await readPenaltyCatalogue('', 'bout-9-never-opened', {
      cardKey: cardCatalogueKey('cards-b'),
      tournamentId: 'tournament-1',
    });

    expect(kept).toMatchObject({ body: catalogueOf('bout-2'), fresh: false });
    // A bout of card rules and a Tournament the tablet holds nothing of has none.
    expect(
      await readPenaltyCatalogue('', 'bout-9', {
        cardKey: cardCatalogueKey('cards-z'),
        tournamentId: 'tournament-9',
      }),
    ).toBeNull();
  });

  // A catalogue that fails, or answers no ruleset (no built-in on the server), keeps nothing out.
  it('keeps the bouts whatever a catalogue read answers', async () => {
    const answers = [() => Promise.reject(new Error('boom')), () => Promise.resolve(json(null))];
    for (const catalogue of answers) {
      await db.reads.clear();
      const { fetchFn } = server();
      vi.stubGlobal('fetch', (url: string) =>
        url.endsWith('/penalty-ruleset') ? catalogue() : fetchFn(url),
      );

      expect(await keepPisteOf('', 'lice-1', fetchFn)).toBe('piste');

      expect(await keptBout('bout-2')).not.toBeNull();
    }
  });

  // The read itself never throws on the network (`fetchWithCache`); the tablet's store can.
  it('keeps the bouts when the tablet’s store refuses a catalogue read', async () => {
    const { fetchFn } = server();
    vi.stubGlobal('fetch', (url: string) =>
      url.endsWith('/penalty-ruleset') ? Promise.reject(new Error('boom')) : fetchFn(url),
    );
    const get = db.reads.get.bind(db.reads);
    vi.spyOn(db.reads, 'get').mockImplementation(((key: string) =>
      key.startsWith('penalty-ruleset/')
        ? Promise.reject(new Error('the store refused'))
        : get(key)) as typeof db.reads.get);

    expect(await keepPisteOf('', 'lice-1', fetchFn)).toBe('piste');

    expect(await keptBout('bout-2')).not.toBeNull();
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
