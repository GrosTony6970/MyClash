import { describe, expect, it } from 'vitest';
import { offlineResponse } from '../offline/failure-kind';
import { readBout } from './bout-read';

const ROW = {
  id: 'bout-1',
  match_number_label: 'M3',
  status: 'running',
  ruleset_code: 'TF',
  ruleset_version: '1.0.0',
  red_registration_id: 'red-1',
  blue_registration_id: 'blue-1',
  red_score: 3,
  blue_score: 2,
  winner_registration_id: null,
  locked_at: null,
  lice_id: 'lice-1',
  end_reason: null,
  current_round: 2,
  red_round_wins: 1,
  blue_round_wins: 0,
  rounds_json: [{ round: 1 }],
  awaiting_round_advance: true,
};
const SUMMARY = {
  roundCode: 'LSW-P1-M3',
  redName: 'Ana Red',
  blueName: 'Bo Blue',
  redClub: 'Club A',
  weapon: 'longsword',
  tournamentId: 'tournament-1',
  tournamentName: 'Longsword Open',
  poolName: 'Pool 1',
  liceName: 'Piste 2',
  phaseType: 'pool',
  bestOf: 3,
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** A fetch that answers the bout's row and its summary, and writes down what was asked. */
function answering(row: () => Response | Promise<Response>, summary = () => json(SUMMARY)) {
  const asked: Array<{ url: string; credentials: unknown }> = [];
  const fetchFn = ((url: string, init?: RequestInit) => {
    asked.push({ url, credentials: init?.credentials });
    return Promise.resolve(url.endsWith('/summary') ? summary() : row());
  }) as typeof fetch;
  return { asked, fetchFn };
}

describe('readBout', () => {
  it('asks the row and the summary of that bout, with the session', async () => {
    const { asked, fetchFn } = answering(() => json(ROW));

    await readBout('https://api.test', 'bout-1', fetchFn);

    expect(asked).toEqual([
      { url: 'https://api.test/api/v1/matches/bout-1', credentials: 'include' },
      { url: 'https://api.test/api/v1/matches/bout-1/summary', credentials: 'include' },
    ]);
  });

  it('builds the bout from the row and the summary', async () => {
    const { fetchFn } = answering(() => json(ROW));

    const read = await readBout('https://api.test', 'bout-1', fetchFn);

    expect(read).toEqual({
      kind: 'bout',
      labelled: true,
      match: {
        id: 'bout-1',
        matchNumberLabel: 'M3',
        roundCode: 'LSW-P1-M3',
        status: 'running',
        rulesetCode: 'TF',
        rulesetVersion: '1.0.0',
        redRegistrationId: 'red-1',
        blueRegistrationId: 'blue-1',
        redScore: 3,
        blueScore: 2,
        winnerRegistrationId: null,
        redFighterName: 'Ana Red',
        blueFighterName: 'Bo Blue',
        redClub: 'Club A',
        blueClub: null,
        weapon: 'longsword',
        tournamentId: 'tournament-1',
        tournamentName: 'Longsword Open',
        poolName: 'Pool 1',
        roundToken: null,
        liceName: 'Piste 2',
        phaseType: 'pool',
        lockedAt: null,
        liceId: 'lice-1',
        endReason: null,
        bestOf: 3,
        currentRound: 2,
        redRoundWins: 1,
        blueRoundWins: 0,
        roundsJson: [{ round: 1 }],
        awaitingRoundAdvance: true,
      },
    });
  });

  it('opens the bout with blank names when the summary is refused', async () => {
    const { fetchFn } = answering(
      () => json({ ...ROW, red_score: null, current_round: null }),
      () => json({ detail: 'no such slot' }, 404),
    );

    const read = await readBout('https://api.test', 'bout-1', fetchFn);

    expect(read.kind).toBe('bout');
    if (read.kind !== 'bout') return;
    // Said, so the page does not keep a bout with no names over a copy that has them.
    expect(read.labelled).toBe(false);
    expect(read.match).toMatchObject({
      redFighterName: '',
      blueFighterName: '',
      redScore: 0,
      bestOf: 1,
      currentRound: 1,
      phaseType: null,
    });
    expect(read.match.tournamentId).toBeUndefined();
  });

  it('says the bout is gone when the server answers that it is', async () => {
    const { fetchFn } = answering(() => json({ detail: 'Not found' }, 404));

    expect(await readBout('https://api.test', 'bout-1', fetchFn)).toEqual({ kind: 'gone' });
  });

  it.each([500, 502, 504, 429, 401, 403])(
    'takes a %i for a fault of the server: neither "gone" nor "no network"',
    async (status) => {
      const { fetchFn } = answering(() => json({ detail: 'boom' }, status));

      expect(await readBout('https://api.test', 'bout-1', fetchFn)).toEqual({ kind: 'failed' });
    },
  );

  it('says "unreachable" for the answer the service worker gives a dead network', async () => {
    const { fetchFn } = answering(() => offlineResponse());

    expect(await readBout('https://api.test', 'bout-1', fetchFn)).toEqual({ kind: 'unreachable' });
  });

  it('says "unreachable" when nothing answers at all', async () => {
    const { fetchFn } = answering(() => Promise.reject(new TypeError('Failed to fetch')));

    expect(await readBout('https://api.test', 'bout-1', fetchFn)).toEqual({ kind: 'unreachable' });
  });

  it('says "unreachable" for an answer it cannot read: a hall’s sign-in page', async () => {
    const { fetchFn } = answering(() => new Response('<html>Sign in to the wifi</html>'));

    expect(await readBout('https://api.test', 'bout-1', fetchFn)).toEqual({ kind: 'unreachable' });
  });
});
