import { afterEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_BOARD, liceBoardPollMs, readLiceBoard } from './lice-board';

/**
 * The piste screen's board (ruling 92). Its live channel is anonymous and RLS
 * keeps a hidden bout's rows off it, so a screen signed in as a club member on
 * a draft Event never heard a bout end and never rolled to the next one.
 */
const BODY = {
  liceId: 'lice-1',
  liceName: 'Piste 1',
  event: { name: 'Open de Lyon' },
  current: { id: 'match-1' },
  queue: [
    {
      id: 'match-2',
      redFighterName: 'Red',
      blueFighterName: 'Blue',
      roundCode: 'P1',
      matchNumberLabel: 'L1-P1-M02',
      scoringConfig: null,
      tournamentName: 'Longsword',
    },
  ],
  hiddenFromPublic: true,
};

function answer(status: number, body: unknown = BODY) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('readLiceBoard', () => {
  it('projects the board, its poll mark included', async () => {
    answer(200);
    expect(await readLiceBoard('slug-1', 'Piste 1')).toEqual({
      liceId: 'lice-1',
      matchId: 'match-1',
      eventName: 'Open de Lyon',
      nextMatch: {
        redFighterName: 'Red',
        blueFighterName: 'Blue',
        roundCode: 'P1',
        matchNumberLabel: 'L1-P1-M02',
        scoringConfig: null,
        tournamentName: 'Longsword',
      },
      hiddenFromPublic: true,
    });
  });

  it('reads a board with no mark as public', async () => {
    answer(200, { ...BODY, hiddenFromPublic: undefined, current: null, queue: [] });
    expect(await readLiceBoard('slug-1', 'Piste 1')).toMatchObject({
      matchId: null,
      nextMatch: null,
      hiddenFromPublic: false,
    });
  });

  it('sends the login, skips the cache and encodes the piste name', async () => {
    const fetchMock = answer(200);
    await readLiceBoard('slug-1', 'Piste 1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    // A regex, not the path as a string: the API's route-contract test reads every
    // quoted API path in the apps, tests included, as a call.
    expect(url).toMatch(/\/v1\/events\/slug-1\/lices\/Piste%201\/current$/);
    expect(init).toMatchObject({ cache: 'no-store', credentials: 'include' });
  });

  it('answers null when the read is refused or never lands', async () => {
    answer(404, { message: 'Event not found' });
    expect(await readLiceBoard('slug-1', 'Piste 1')).toBeNull();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    );
    expect(await readLiceBoard('slug-1', 'Piste 1')).toBeNull();
  });
});

describe('liceBoardPollMs', () => {
  it('does not poll a public board: its channel announces every change', () => {
    expect(liceBoardPollMs(EMPTY_BOARD, false)).toBeNull();
    expect(liceBoardPollMs({ ...EMPTY_BOARD, liceId: 'lice-1', matchId: 'm' }, false)).toBeNull();
  });

  it('polls a hidden board every five seconds', () => {
    expect(liceBoardPollMs({ ...EMPTY_BOARD, hiddenFromPublic: true }, false)).toBe(5_000);
  });

  // A kiosk that starts with an expired login is refused until its keep-alive
  // renews the login; no channel event announces that a retry would now work.
  it('retries a failed read every five seconds', () => {
    expect(liceBoardPollMs(EMPTY_BOARD, true)).toBe(5_000);
  });
});
