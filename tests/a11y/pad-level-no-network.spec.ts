/**
 * A level bout runs on the tablet, with a network or with none (operator
 * ruling 13 of the quick-win list, and the ruling of 2026-10-12: the step of a
 * level bout pauses a clock that runs).
 *
 * A bracket bout, 3 - 3 at the end of its 90 seconds. The official taps "Extra
 * time", fights it, and at the next 0:00 taps "Sudden death": the next hit
 * leads, and "End match" ends the bout. Before, the step was the one button of
 * a bout that waited for the server: with no wifi it was greyed, or answered
 * "No connection", and a level bout could not go on. Now each step acts on the
 * screen, is kept in the tablet's queue in the order of the bout, and is sent
 * when the network is back.
 *
 * The API is stubbed, and it keeps the clock and the steps as the server does.
 * The stories give 2 seconds of extra time, so none waits a minute. The rules
 * have their unit tests (`pad-clock.level.test.ts`, `sync.level.test.ts`), and
 * the server its own (`level-step.late.test.ts`).
 */
import { test, expect, type Page } from '@playwright/test';
import {
  comeBackOnline,
  held,
  levelStep,
  openBout,
  primary,
  redHit,
  result,
  status,
} from './pad-clock-stub';

/** 90 seconds, first to 10; a level bracket bout plays 2 s of extra time, then sudden death. */
const rules = (bestOf: number) => ({
  scoringConfig: {
    afterblowMode: 'full',
    buttons: {
      clean: [{ label: '+1', value: 1, visible: true }],
      afterblow: [],
    },
    display: { sideColors: { red: 'red', blue: 'blue' } },
  },
  matchFormat: {
    pointCap: 10,
    scoringDirection: 'normal',
    timerMode: 'countdown',
    timeLimitsSeconds: { pool: 90, bracket: 90, finals: 90 },
    // No soft zone: a Resume with 2 seconds left is not asked about.
    softClockLimitSeconds: 0,
    maxDoubleHits: null,
    maxDoubleHitOutcome: 'double_loss_zero_scores',
    bestOf: { pool: 1, bracket: bestOf, finals: 1 },
    levelAtTime: {
      pool: [{ kind: 'draw' }],
      bracket: [{ kind: 'extra_time', seconds: 2 }, { kind: 'sudden_death' }],
      finals: [{ kind: 'sudden_death' }],
    },
  },
});

/** The bout: level at 3 - 3, its clock paused at 0:00. */
const levelAtTime = (bestOf = 1) => ({
  phaseType: 'single_elim',
  rules: rules(bestOf),
  bestOf,
  afterExtraTimeMs: 88_000,
  row: { status: 'paused', red_score: 3, blue_score: 3 },
  clock: { status: 'halted' as const, activeMs: 90_000, startedAt: '2026-01-01T10:00:00.000Z' },
});

const clockReads = (page: Page, time: string) =>
  expect(page.locator('main').getByText(time, { exact: false }).first()).toBeVisible();
const skull = (page: Page) => page.getByTestId('sudden-death');

/** The rules are read: the step the chain names is on its button. */
async function open(page: Page, bestOf = 1) {
  const stub = await openBout(page, levelAtTime(bestOf));
  await expect(levelStep(page)).toHaveAttribute('data-remedy', 'extra_time');
  return stub;
}

test('with no network, a level bout goes through extra time and sudden death to its End, and goes to the server in its own order', async ({
  page,
}) => {
  const stub = await open(page);
  stub.network = 'down';

  // Extra time: the clock is paused with the 2 seconds on it, and the step is taken.
  await levelStep(page).click();
  await expect(status(page)).toHaveAttribute('data-status', 'halted');
  await clockReads(page, '00:02');
  await expect(levelStep(page), 'no step is offered while time is left').toHaveCount(0);

  // The extra time is fought. At its end the board is still level: the next
  // step is sudden death, and it is tapped while the clock still runs.
  await primary(page).click();
  await expect(status(page)).toHaveAttribute('data-status', 'running');
  await expect(levelStep(page)).toHaveAttribute('data-remedy', 'sudden_death');
  await levelStep(page).click();

  // The step paused the clock (operator, 2026-10-12), and sudden death is live.
  await expect(status(page)).toHaveAttribute('data-status', 'halted');
  await expect(skull(page)).toBeVisible();
  await expect(levelStep(page), 'the chain is spent').toHaveCount(0);

  // A hit leads, and "End match" ends the bout on the tablet.
  await redHit(page).click();
  await expect(skull(page), 'a fighter leads: sudden death is over').toHaveCount(0);
  await page.getByTestId('clock-end-button').click();
  await expect(result(page)).toBeVisible();
  await expect(page.getByTestId('match-result-unconfirmed')).toBeVisible();
  expect(stub.sent).toEqual([]);

  await comeBackOnline(page, stub);

  await expect
    .poll(() => stub.sent)
    .toEqual([
      'POST /level 0',
      'POST /clock resume',
      'POST /level 1',
      'POST /exchanges',
      'POST /clock end',
    ]);
  await expect(page.getByTestId('match-result-unconfirmed')).toHaveCount(0);
  await expect(result(page)).toBeVisible();
  await expect(held(page)).toHaveCount(0);
});

test('with a network the step acts on the tap, before the server answers, and nothing goes back when it does', async ({
  page,
}) => {
  const stub = await open(page);
  let answer = () => {};
  stub.holdLevel = new Promise<void>((resolve) => {
    answer = resolve;
  });

  await levelStep(page).click();

  // The server has not answered: the extra time is on the tablet's clock.
  await clockReads(page, '00:02');
  await expect(levelStep(page)).toHaveCount(0);
  await expect.poll(() => stub.arrived).toEqual(['level']);
  expect(stub.sent).toEqual([]);

  answer();
  await expect.poll(() => stub.sent).toEqual(['POST /level 0']);
  // The server's clock says the same: the screen keeps the 2 seconds, and its one step.
  await clockReads(page, '00:02');
  await expect(levelStep(page)).toHaveCount(0);
  await expect(held(page)).toHaveCount(0);
  // The next press of the bout is behind the step, and no step is sent twice.
  await primary(page).click();
  await expect.poll(() => stub.sent).toEqual(['POST /level 0', 'POST /clock resume']);
});

test('a step the server refuses is held, said at the clock, and the clock goes back to the server’s', async ({
  page,
}) => {
  const stub = await open(page);
  stub.refuseNextLevel = 'bout_not_level';

  await levelStep(page).click();

  await expect(held(page)).toContainText(/extra time or sudden death step/i);
  await expect(held(page)).toContainText(/not level/i);
  // The server gave no time: the clock is at 0:00 again, with the step not taken.
  await clockReads(page, '00:00');
  await expect(levelStep(page)).toHaveAttribute('data-remedy', 'extra_time');
  expect(stub.sent).toEqual(['POST /level 0']);
});

test('a level round of a best-of bout does the same with no network, and "End round" then closes it', async ({
  page,
}) => {
  const stub = await open(page, 3);
  stub.network = 'down';

  // The round is level at its time: "End round" is refused on the tablet.
  await page.getByTestId('clock-end-button').click();
  await expect(
    page
      .locator('main')
      .getByText(/extra time/i)
      .first(),
  ).toBeVisible();

  await levelStep(page).click();
  await clockReads(page, '00:02');
  await primary(page).click();
  await expect(levelStep(page)).toHaveAttribute('data-remedy', 'sudden_death');
  await levelStep(page).click();
  await expect(skull(page)).toBeVisible();

  await redHit(page).click();
  await page.getByTestId('clock-end-button').click();

  // The round is closed on the tablet for the leader; nothing was sent.
  await expect(page.getByTestId('start-next-round')).toBeVisible();
  await expect(page.getByTestId('round-closed-on-tablet')).toBeVisible();
  expect(stub.sent).toEqual([]);
});
