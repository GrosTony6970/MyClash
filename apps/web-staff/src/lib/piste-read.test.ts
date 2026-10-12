import { describe, expect, it } from 'vitest';
import { offlineResponse } from '../offline/failure-kind';
import { readBout } from './bout-read';
import { readPiste } from './piste-read';
import { PISTE, json, row, summary } from './piste-read.fixtures';

const answering = (answer: () => Response | Promise<Response>) => {
  const asked: Array<{ url: string; credentials: unknown }> = [];
  const fetchFn = ((url: string, init?: RequestInit) => {
    asked.push({ url, credentials: init?.credentials });
    return Promise.resolve(answer());
  }) as typeof fetch;
  return { asked, fetchFn };
};

describe('readPiste', () => {
  it('asks the bouts of that piste, with the session', async () => {
    const { asked, fetchFn } = answering(() => json(PISTE));

    await readPiste('https://api.test', 'lice-1', fetchFn);

    expect(asked).toEqual([
      { url: 'https://api.test/api/v1/staff/lices/lice-1/bouts', credentials: 'include' },
    ]);
  });

  it('gives the bouts in the order of the answer, one with no summary with no names', async () => {
    const { fetchFn } = answering(() => json(PISTE));

    const read = await readPiste('https://api.test', 'lice-1', fetchFn);

    expect(read.kind).toBe('piste');
    if (read.kind !== 'piste') return;
    expect(read.bouts.map((bout) => [bout.id, bout.redFighterName, bout.tournamentId])).toEqual([
      ['bout-1', 'Red bout-1', 'tournament-1'],
      ['bout-2', 'Red bout-2', 'tournament-2'],
      ['bout-3', '', undefined],
    ]);
    expect(read.bouts[1]).toMatchObject({
      redFighterName: 'Red bout-2',
      tournamentId: 'tournament-2',
      liceId: 'lice-1',
      redRegistrationId: 'red-bout-2',
    });
  });

  // One shape for a copy, whoever read it: the bout screen opens both.
  it('builds a bout exactly as the read of that one bout builds it', async () => {
    const { fetchFn } = answering(() => json(PISTE));
    const piste = await readPiste('https://api.test', 'lice-1', fetchFn);

    const one = await readBout('https://api.test', 'bout-1', ((url: string) =>
      Promise.resolve(
        json(url.endsWith('/summary') ? summary('bout-1') : PISTE.bouts[0]!.match),
      )) as typeof fetch);

    expect(one.kind === 'bout' && one.match).toEqual(piste.kind === 'piste' && piste.bouts[0]);
  });

  it('is "refused" for a session that may not read the piste', async () => {
    for (const status of [401, 403]) {
      const { fetchFn } = answering(() => json({ detail: 'no' }, status));
      expect(await readPiste('', 'lice-1', fetchFn)).toEqual({ kind: 'refused' });
    }
  });

  it('is "unreachable" with no network: the worker’s answer, an edge 503, no answer', async () => {
    const dead = [
      () => offlineResponse(),
      () => json({ detail: 'Bad gateway' }, 503),
      () => Promise.reject(new TypeError('Failed to fetch')),
    ];
    for (const answer of dead) {
      const { fetchFn } = answering(answer);
      expect(await readPiste('', 'lice-1', fetchFn)).toEqual({ kind: 'unreachable' });
    }
  });

  it('is "failed" for a fault of the server, and for an answer that is no piste', async () => {
    const faults = [
      () => json({ detail: 'boom' }, 500),
      () => json({ detail: 'Lice not found' }, 404),
      () => new Response('<html>sign in to the hall wifi</html>', { status: 200 }),
      () => json({ liceId: 'lice-1' }),
      () => json({ bouts: [{ match: null, summary: null }] }),
      () => json({ bouts: [{ match: { ...row('x'), id: '' }, summary: null }] }),
    ];
    for (const answer of faults) {
      const { fetchFn } = answering(answer);
      expect(await readPiste('', 'lice-1', fetchFn)).toEqual({ kind: 'failed' });
    }
  });

  it('gives an empty piste as a piste with no bout', async () => {
    const { fetchFn } = answering(() => json({ liceId: 'lice-1', liceName: 'P', bouts: [] }));
    expect(await readPiste('', 'lice-1', fetchFn)).toEqual({ kind: 'piste', bouts: [] });
  });
});
