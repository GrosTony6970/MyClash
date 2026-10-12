import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { apiFor, type Api } from './_api';
import { POINT_CAP, aMatch, hit, readMatch } from './_pad';

/**
 * The presses a tablet sends through its queue, with the bodies the tablet
 * sends (run with `E2E_SCORING_PAD=1`).
 *
 * Since the clock runs on the tablet, a Start, a Pause, a Resume, an End, the
 * two round buttons and the step of a level bout each carry an id the tablet
 * made, and two times of which the server reads only the difference (how long
 * ago the press was made). The tablet sends a press again whenever its answer
 * was lost, so the promise that matters most is "once": a press with one id is
 * taken one time, however often it arrives.
 *
 * `10-scoring-pad.spec.ts` drives the same doors with the bodies that carry no
 * id, and `16-pad-ui.spec.ts` sends each press once, from a browser with a
 * network. Nothing sent a press twice. The server's rules have their unit
 * tests against a database double, which does not keep what is written to it:
 * "the second send writes nothing" needs a real database.
 *
 * WRITTEN BY READING THE CODE, on 2026-10-12, when the deployed build was
 * older than these doors. Read its first run as a first run.
 */
const SCORING_PAD = ['1', 'true', 'yes'].includes(
  (process.env.E2E_SCORING_PAD ?? '').toLowerCase(),
);

test.skip(() => !SCORING_PAD, 'set E2E_SCORING_PAD=1 to send the tablet’s presses for real');

interface ClockRead {
  status: string;
  levelResolutionSteps: number;
  events: Array<{ type: string }>;
}

/** The two times of a press made `agoMs` before it is sent. */
function times(agoMs = 0): { pressedAt: string; sentAt: string } {
  const sent = Date.now();
  return {
    pressedAt: new Date(sent - agoMs).toISOString(),
    sentAt: new Date(sent).toISOString(),
  };
}

const readClock = async (api: Api, matchId: string): Promise<ClockRead> =>
  api.json<ClockRead>(await api.get(`matches/${matchId}/clock`));

const rowsOf = (clock: ClockRead, type: string): number =>
  clock.events.filter((event) => event.type === type).length;

test('a Start sent twice with one id is taken once', async ({ request }) => {
  test.setTimeout(300_000);
  const api = apiFor(request);
  const { matchId } = await aMatch(api, 'late-start');
  const press = (action: string, clientUuid: string) =>
    api.post(`matches/${matchId}/clock`, { data: { action, clientUuid, ...times() } });

  const start = randomUUID();
  await api.ok(await press('start', start));
  await api.ok(await press('start', start));
  let clock = await readClock(api, matchId);
  expect(clock.status).toBe('running');
  expect(rowsOf(clock, 'start'), 'one Start in the timeline').toBe(1);

  // A Start from another tablet asks for what is already true: done, no line.
  await api.ok(await press('start', randomUUID()));
  expect(rowsOf(await readClock(api, matchId), 'start')).toBe(1);

  // The first Start arrives once more after a Pause: it starts nothing again.
  await api.ok(await press('halt', randomUUID()));
  await api.ok(await press('start', start));
  clock = await readClock(api, matchId);
  expect(clock.status, 'an old Start does not restart a paused clock').toBe('halted');
  expect(rowsOf(clock, 'start')).toBe(1);
});

test('a press made more than a day before its send is refused', async ({ request }) => {
  test.setTimeout(300_000);
  const api = apiFor(request);
  const { matchId } = await aMatch(api, 'late-old');
  const dayAndAnHour = 25 * 60 * 60 * 1000;

  const old = await api.post(`matches/${matchId}/clock`, {
    data: { action: 'start', clientUuid: randomUUID(), ...times(dayAndAnHour) },
  });

  expect(old.status()).toBe(409);
  expect((await old.json())['code']).toBe('clock_press_too_old');
  expect((await readClock(api, matchId)).status).toBe('idle');
});

test('"Start round 2" sent twice with one id opens round 2 once', async ({ request }) => {
  test.setTimeout(300_000);
  const api = apiFor(request);
  const { matchId } = await aMatch(api, 'late-round', {
    bestOf: { pool: 3, bracket: 3, finals: 3 },
  });
  for (let i = 0; i < POINT_CAP; i++) {
    await hit(api, matchId, { type: 'clean', firstStrikerColor: 'red', firstStrikeValue: 1 });
  }
  expect((await readMatch(api, matchId)).awaiting_round_advance).toBe(true);

  const body = { clientUuid: randomUUID(), round: 2, ...times() };
  const advance = () => api.post(`matches/${matchId}/rounds/advance`, { data: body });
  expect(await api.json<{ currentRound: number }>(await advance())).toEqual({ currentRound: 2 });

  // Round 2 is in play, 1 - 0. The same press arrives again: nothing moves.
  await hit(api, matchId, { type: 'clean', firstStrikerColor: 'red', firstStrikeValue: 1 });
  expect(await api.json<{ currentRound: number }>(await advance())).toEqual({ currentRound: 2 });

  const match = await readMatch(api, matchId);
  expect(match.current_round).toBe(2);
  expect(match.awaiting_round_advance).toBe(false);
  expect({ red: match.red_score, blue: match.blue_score }).toEqual({ red: 1, blue: 0 });
  expect(match.red_round_wins).toBe(1);
});

/**
 * No time limit (0 seconds), so the time is finished at once and a bout at
 * 0 - 0 is level: its first step can be taken on a clock that runs.
 */
test('a step of a level bout sent late pauses a clock that runs, and is taken once', async ({
  request,
}) => {
  test.setTimeout(300_000);
  const api = apiFor(request);
  const { matchId } = await aMatch(api, 'late-level', {
    timeLimitsSeconds: { pool: 0, bracket: 0, finals: 0 },
  });
  await api.ok(
    await api.post(`matches/${matchId}/clock`, {
      data: { action: 'start', clientUuid: randomUUID(), ...times() },
    }),
  );
  const step = (clientUuid: string, taken: number) =>
    api.post(`matches/${matchId}/level-resolution/advance`, {
      data: { clientUuid, round: 1, step: taken, ...times() },
    });

  // Ruled 2026-10-12: the step pauses the clock; the official taps Resume.
  const first = randomUUID();
  const answer = await api.json<ClockRead>(await step(first, 0));
  expect(answer.status, 'the answer is the clock alone, paused').toBe('halted');
  expect(answer.levelResolutionSteps).toBe(1);
  expect(answer).not.toHaveProperty('applied');
  expect((await readMatch(api, matchId)).status).toBe('paused');

  // The same step again, then the same step from another tablet: both done.
  await api.ok(await step(first, 0));
  await api.ok(await step(randomUUID(), 0));
  const clock = await readClock(api, matchId);
  expect(clock.levelResolutionSteps, 'one step, not three').toBe(1);
  expect(rowsOf(clock, 'level_resolution')).toBe(1);

  // A tablet that counts a step the server never took is refused, with a code.
  const ahead = await step(randomUUID(), 2);
  expect(ahead.status()).toBe(400);
  expect((await ahead.json())['code']).toBe('level_step_not_pending');
});
