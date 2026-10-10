/**
 * The clock works on the tablet, with a network or with none (operator rulings
 * 2 and 11 to 14 of the quick-win list, and ruling A of 2026-10-10: a clock
 * press always acts at once and is sent behind).
 *
 * A table has no wifi. The official starts the clock, stops it, scores and
 * ends the bout. Before, the pad said "No connection" and the bout could not
 * start. Now each press acts on the screen, is kept in the tablet's queue with
 * the hits, in the order of the bout, and is sent when the network is back.
 * Only a live page proves what the official sees; the unit tests hold the
 * rules (`pad-clock.test.ts`, `sync.press.test.ts`, `end-guard.test.ts`).
 *
 * The API is stubbed, and it keeps a clock as the server does. A dead network
 * is the answer the pad's service worker gives: a 503 with `{ error:
 * 'offline' }`. The bout has the default format: 90 seconds, first to 10.
 */
import { test, expect } from '@playwright/test';
import {
  comeBackOnline,
  expectKeptClock,
  held,
  openBout,
  primary,
  redHit,
  result,
  status,
} from './pad-clock-stub';

test('Start runs the clock on the tap, before the server answers, and is sent with its id and its age', async ({
  page,
}) => {
  const stub = await openBout(page);
  let answer = () => {};
  stub.hold = new Promise<void>((resolve) => {
    answer = resolve;
  });

  await primary(page).click();

  // The server has not answered: the clock runs on the tablet.
  await expect(status(page)).toHaveAttribute('data-status', 'running');
  await expect(primary(page)).toHaveAttribute('data-action', 'halt');
  await expect(primary(page)).toBeEnabled();
  expect(stub.sent).toEqual([]);

  answer();
  await expect.poll(() => stub.sent).toEqual(['POST /clock start']);
  const [body] = stub.presses;
  expect(body?.clientUuid).toMatch(/^[0-9a-f-]{36}$/);
  expect(Date.parse(body!.sentAt)).toBeGreaterThanOrEqual(Date.parse(body!.pressedAt));
  // The server's answer keeps the clock running: nothing goes back.
  await expect(status(page)).toHaveAttribute('data-status', 'running');
  await expect(held(page)).toHaveCount(0);
});

test('with no network, a bout runs from Start to End on the tablet, and goes to the server in its own order', async ({
  page,
}) => {
  const stub = await openBout(page);
  stub.network = 'down';

  await primary(page).click();
  await expect(status(page)).toHaveAttribute('data-status', 'running');
  await primary(page).click();
  await expect(status(page)).toHaveAttribute('data-status', 'halted');
  // The bout is in play on the tablet: a hit is taken, with no word from the server.
  await redHit(page).first().click();
  await expect(page.getByTestId('provisional-score').first()).toBeVisible();

  await page.getByTestId('clock-end-button').click();
  await page.getByTestId('end-early-confirm').click();

  // Ended on the tablet: its own score and winner, marked as not confirmed.
  await expect(result(page)).toBeVisible();
  await expect(page.getByTestId('match-result-unconfirmed')).toContainText(/not confirmed/i);
  await expect(page.getByTestId('match-result-winner')).toContainText('Ana Red');
  await expect(page.getByTestId('match-result-score')).toHaveText('2 – 0');
  // Re-open is a person's, with the network: it waits for the queue.
  await expect(primary(page)).toHaveAttribute('data-action', 'reopen');
  await expect(primary(page)).toBeDisabled();
  expect(stub.sent).toEqual([]);

  // The network is back, and the server is slow to answer the End: the hit has
  // left the queue, and the bout's row is still the one from before the bout.
  let answerEnd = () => {};
  stub.holdEnd = new Promise<void>((resolve) => {
    answerEnd = resolve;
  });
  await comeBackOnline(page, stub);
  await expect.poll(() => stub.arrived).toEqual(['start', 'halt', 'hit', 'end']);

  // The result does not move while the queue goes out: no "Draw 0 – 0" on the way.
  await expect(page.getByTestId('match-result-score')).toHaveText('2 – 0');
  await expect(page.getByTestId('match-result-winner')).toContainText('Ana Red');
  await expect(page.getByTestId('match-result-unconfirmed')).toBeVisible();

  answerEnd();
  await expect
    .poll(() => stub.sent)
    .toEqual(['POST /clock start', 'POST /clock halt', 'POST /exchanges', 'POST /clock end']);
  // The age of each press is its own: the Start is the oldest, and none is zero.
  const ages = stub.presses.map((p) => Date.parse(p.sentAt) - Date.parse(p.pressedAt));
  expect(ages[0]).toBeGreaterThan(ages[2] as number);
  expect(Math.min(...ages)).toBeGreaterThan(0);
  // The server confirmed the End: the result is the server's now.
  await expect(page.getByTestId('match-result-unconfirmed')).toHaveCount(0);
  await expect(page.getByTestId('match-result-score')).toHaveText('2 – 0');
  await expect(primary(page)).toBeEnabled();
});

test('the result stays the tablet’s own, and not confirmed, when the bout cannot be read after the End', async ({
  page,
}) => {
  const stub = await openBout(page);
  stub.network = 'down';
  await primary(page).click();
  await primary(page).click();
  await expect(status(page)).toHaveAttribute('data-status', 'halted');
  await redHit(page).first().click();
  await page.getByTestId('clock-end-button').click();
  await page.getByTestId('end-early-confirm').click();
  await expect(result(page)).toBeVisible();

  // The queue goes out, and the wifi drops again before the bout is read.
  stub.readsFail = true;
  await comeBackOnline(page, stub);
  await expect.poll(() => stub.sent.length).toBe(4);

  // Not the server's old row ("Draw 0 – 0"), and still said as not confirmed.
  await expect(page.getByTestId('match-result-unconfirmed')).toBeVisible();
  await expect(page.getByTestId('match-result-score')).toHaveText('2 – 0');
  await expect(page.getByTestId('match-result-draw')).toHaveCount(0);

  stub.readsFail = false;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByTestId('match-result-unconfirmed')).toHaveCount(0);
  await expect(page.getByTestId('match-result-score')).toHaveText('2 – 0');
});

test('a press the server refuses goes back, says why at the clock, and holds the presses behind it', async ({
  page,
}) => {
  const stub = await openBout(page);
  stub.refuseNext = 'clock_press_out_of_order';

  await primary(page).click();

  await expect(held(page)).toHaveAttribute('role', 'alert');
  await expect(held(page)).toContainText(/the server refused a clock press of this match/i);
  await expect(held(page)).toContainText(/moved from somewhere else/i);
  await expect(held(page)).toContainText(/open review/i);
  // The pad's own sentence, never the API's.
  await expect(page.locator('main').getByText('API words')).toHaveCount(0);
  await expect(status(page)).toHaveAttribute('data-status', 'idle');
  await expect(page.getByTestId('network-bar')).toContainText(/a clock press was refused/i);

  // A second Start acts on the tablet, and waits behind the refused one.
  await primary(page).click();
  await expect(status(page)).toHaveAttribute('data-status', 'running');

  await page.getByTestId('review-refused').click();
  const row = page.getByTestId('quarantine-row');
  await expect(row).toContainText('Clock: Start');
  await expect(row).toContainText('P1 · Ana Red – Bo Blue');
  await expect(page.getByTestId('quarantine-waiting')).toHaveText(
    '1 entry of this match waits behind it.',
  );
  await row.getByRole('button', { name: /^discard$/i }).click();
  await expect(page.getByRole('dialog').getByText(/discard this clock press\?/i)).toBeVisible();
  await page.getByRole('button', { name: /discard permanently/i }).click();

  // The discard frees the second Start: it is the second call, and no other was made.
  await expect.poll(() => stub.sent).toEqual(['POST /clock start', 'POST /clock start']);
  expect(stub.presses[0]?.clientUuid).not.toBe(stub.presses[1]?.clientUuid);
  await expect(held(page)).toHaveCount(0);
  await expect(page.getByTestId('network-bar')).not.toContainText(/refused/i);
});

test('with no network, a reloaded pad opens the clock the tablet kept, and a press moves it', async ({
  page,
}) => {
  const stub = await openBout(page, {
    row: { status: 'paused', red_score: 3, blue_score: 2 },
    clock: { status: 'halted', activeMs: 30_000, startedAt: '2026-01-01T10:00:00.000Z' },
  });
  await expectKeptClock(page, 'halted');

  stub.network = 'down';
  await page.reload();

  await expect(page.getByTestId('bout-from-tablet')).toContainText(/the clock included/i);
  await expect(status(page)).toHaveAttribute('data-status', 'halted');
  await expect(primary(page)).toHaveAttribute('data-action', 'resume');
  // The time the server had: 30 seconds run of 90, so one minute is left.
  await expect(page.locator('main').getByText('01:00', { exact: false }).first()).toBeVisible();

  await primary(page).click();
  await expect(status(page)).toHaveAttribute('data-status', 'running');
  expect(stub.sent).toEqual([]);
});

test('a level bracket bout at its time: the tablet does not end it, and says what to play', async ({
  page,
}) => {
  const stub = await openBout(page, {
    phaseType: 'single_elim',
    row: { status: 'paused', red_score: 3, blue_score: 3 },
    clock: { status: 'halted', activeMs: 90_000, startedAt: '2026-01-01T10:00:00.000Z' },
  });

  await page.getByTestId('clock-end-button').click();

  await expect(
    page
      .locator('main')
      .getByText(/extra time/i)
      .first(),
  ).toBeVisible();
  await expect(result(page)).toHaveCount(0);
  await expect(status(page)).toHaveAttribute('data-status', 'halted');

  // No End was sent: the hit the official scores next is the first call.
  await page.getByTestId('double-button').click();
  await expect.poll(() => stub.sent).toEqual(['POST /exchanges']);
});
