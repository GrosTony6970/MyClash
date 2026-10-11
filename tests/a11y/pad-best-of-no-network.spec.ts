/**
 * A best-of bout runs on the tablet with no network (the offline bout, slice
 * 4b; operator rulings of 2026-10-10).
 *
 * A table has no wifi. Red reaches the cap in round 1 of a best-of-3: the
 * tablet closes the round on the score it shows and says it is not confirmed.
 * "Start round 2" works, the score and the clock go to zero, and round 2 is
 * played. When the wifi is back the tablet sends the bout in the order it
 * happened, and the official does nothing.
 *
 * The API is stubbed (`pad-rounds-stub.ts` keeps the rounds as the server
 * does). The round view has the unit tests (`pad-series.test.ts`,
 * `pad-series.memory.test.ts`), the queue has `sync.round.test.ts`, and an API
 * test parses the body of a round press with the route's own schema.
 */
import { test, expect } from '@playwright/test';
import {
  comeBackOnline,
  gate,
  held,
  notConfirmedRound,
  openBestOf,
  plusOne,
  plusTwo,
  primary,
  queuedOnTablet,
  result,
  roundBreak,
  startAndHalt,
  startNextRound,
  status,
} from './pad-rounds-stub';

test('with no network a best-of-3 runs to its end on the tablet, and goes to the server in its own order', async ({
  page,
}) => {
  const stub = await openBestOf(page);
  stub.network = 'down';
  await startAndHalt(page);

  // Red reaches the cap: the tablet closes round 1 by itself, and says so.
  await plusTwo(page, 'red').click();
  await expect(roundBreak(page)).toContainText(/round 1 complete/i);
  await expect(roundBreak(page)).toContainText('Ana Red');
  await expect(roundBreak(page)).toContainText('2 – 0');
  await expect(notConfirmedRound(page)).toHaveText('Closed on this tablet, not confirmed.');

  // "Start round 2" works with no network: round 2 opens at 0-0, the clock at zero.
  await startNextRound(page).click();
  await expect(roundBreak(page)).toHaveCount(0);
  await expect(page.getByText(/round 2/i).first()).toBeVisible();
  await expect(status(page)).toHaveAttribute('data-status', 'halted');
  await expect(primary(page)).toHaveAttribute('data-action', 'resume');
  await expect(plusTwo(page, 'red')).toBeEnabled();

  // Blue scores one, then red takes round 2 by 2-1: the series is decided on
  // the tablet, and not confirmed.
  await plusOne(page, 'blue').click();
  await plusTwo(page, 'red').click();
  await expect(result(page)).toBeVisible();
  await expect(page.getByTestId('match-result-unconfirmed')).toContainText(/not confirmed/i);
  await expect(page.getByTestId('match-result-winner')).toContainText('Ana Red');
  // The rounds won, not the last round's points.
  await expect(page.getByTestId('match-result-score')).toHaveText('2 – 0');
  // Under it, the points of each round.
  await expect(page.getByTestId('match-result-rounds')).toHaveText(
    'Points per round: 2 – 0 · 2 – 1',
  );
  expect(stub.sent, 'nothing reached the server').toEqual([]);

  await comeBackOnline(page, stub);

  // The whole bout, in the order it happened.
  await expect
    .poll(() => stub.sent)
    .toEqual([
      'POST /clock start',
      'POST /clock halt',
      'POST /exchanges',
      'POST /rounds/advance 2',
      'POST /exchanges',
      'POST /exchanges',
    ]);
  expect(stub.row).toMatchObject({
    status: 'completed',
    red_round_wins: 2,
    current_round: 2,
    red_score: 2,
    blue_score: 1,
  });
  // The round press said which round it opens, with its id and its two times.
  expect(Object.keys(stub.roundBodies[0] ?? {}).sort()).toEqual([
    'clientUuid',
    'pressedAt',
    'round',
    'sentAt',
  ]);
  // The server confirmed it: the result is the server's now.
  await expect(page.getByTestId('match-result-unconfirmed')).toHaveCount(0);
  await expect(result(page)).toBeVisible();
  // The same number confirmed: the rounds won, not the last round's points.
  await expect(page.getByTestId('match-result-score')).toHaveText('2 – 0');
  await expect(page.getByTestId('match-result-rounds')).toHaveText(
    'Points per round: 2 – 0 · 2 – 1',
  );
  await expect(held(page)).toHaveCount(0);
});

test('"End round" with no network gives the round to the leader, and is sent before "Start round 2"', async ({
  page,
}) => {
  const stub = await openBestOf(page);
  stub.network = 'down';
  await startAndHalt(page);
  await plusOne(page, 'blue').click();

  await page.getByTestId('clock-end-button').click();

  await expect(roundBreak(page)).toContainText(/round 1 complete/i);
  await expect(roundBreak(page)).toContainText('Bo Blue');
  await expect(roundBreak(page)).toContainText('0 – 1');
  await expect(notConfirmedRound(page)).toBeVisible();
  await startNextRound(page).click();
  await expect(page.getByText(/round 2/i).first()).toBeVisible();

  await comeBackOnline(page, stub);

  await expect
    .poll(() => stub.sent)
    .toEqual([
      'POST /clock start',
      'POST /clock halt',
      'POST /exchanges',
      'POST /rounds/end 1',
      'POST /rounds/advance 2',
    ]);
  expect(stub.row).toMatchObject({ current_round: 2, blue_round_wins: 1, status: 'paused' });
  // The server has the same round 2: the screen stays on it.
  await expect(roundBreak(page)).toHaveCount(0);
  await expect(page.getByText(/round 2/i).first()).toBeVisible();
});

test('a level round is not ended on the tablet: the pad says why, and queues nothing', async ({
  page,
}) => {
  const stub = await openBestOf(page);
  stub.network = 'down';
  await startAndHalt(page);

  // 0-0 with the time not finished.
  await page.getByTestId('clock-end-button').click();

  await expect(roundBreak(page)).toHaveCount(0);
  await expect(page.locator('main').getByText(/level/i).first()).toBeVisible();

  await comeBackOnline(page, stub);
  await expect.poll(() => stub.sent).toEqual(['POST /clock start', 'POST /clock halt']);
});

test('at the end of the time, the resume warning of a best-of bout ends the ROUND, not the bout', async ({
  page,
}) => {
  // The format's time is 90 s: the clock is halted on it, and red leads 1-0.
  const stub = await openBestOf(page, { haltedAtMs: 90_000 });
  stub.network = 'down';
  await expect(primary(page)).toHaveAttribute('data-action', 'resume');
  await plusOne(page, 'red').click();

  await primary(page).click();

  const warning = page.getByRole('dialog');
  await expect(warning).toContainText(/time is up/i);
  await expect(warning).toContainText(/or end the round\?/i);
  await expect(warning.getByRole('button', { name: /end match/i })).toHaveCount(0);
  await warning.getByRole('button', { name: /^end round$/i }).click();

  // The round is closed for its leader, on the tablet, and round 2 can start.
  await expect(roundBreak(page)).toContainText(/round 1 complete/i);
  await expect(roundBreak(page)).toContainText('Ana Red');
  await expect(roundBreak(page)).toContainText('1 – 0');
  await expect(notConfirmedRound(page)).toBeVisible();
  await expect(result(page)).toHaveCount(0);

  await comeBackOnline(page, stub);

  // The whole list: an End of the round, and no End of the clock, which
  // completed the bout with no winner and no round closed.
  await expect.poll(() => stub.sent).toEqual(['POST /exchanges', 'POST /rounds/end 1']);
  expect(stub.row).toMatchObject({ status: 'paused', red_round_wins: 1, current_round: 1 });
  await expect(notConfirmedRound(page)).toHaveCount(0);
  await expect(roundBreak(page)).toContainText(/round 1 complete/i);
});

test('when the server counts another way, "Start round 2" is held and the screen goes back to the server’s round', async ({
  page,
}) => {
  // The server closes a round at 3: the tablet's cap of 2 is not the server's.
  const stub = await openBestOf(page, { serverCap: 3 });
  stub.network = 'down';
  await startAndHalt(page);
  await plusTwo(page, 'red').click();
  await startNextRound(page).click();
  await plusOne(page, 'blue').click();
  await expect(page.getByText(/round 2/i).first()).toBeVisible();

  await comeBackOnline(page, stub);

  // The hit of round 2 was NOT sent into the server's round 1: it waits behind the held press.
  await expect
    .poll(() => stub.sent)
    .toEqual([
      'POST /clock start',
      'POST /clock halt',
      'POST /exchanges',
      'POST /rounds/advance 2',
    ]);
  // Said at the clock, in the pad's words, with the way out.
  await expect(held(page)).toContainText(/the server is not waiting for this round to start/i);
  await expect(held(page)).not.toContainText('API words');
  // Back to what the server says: round 1, open, no round-break screen.
  await expect(page.getByText(/round 1/i).first()).toBeVisible();
  await expect(roundBreak(page)).toHaveCount(0);
  expect(stub.row).toMatchObject({ current_round: 1, awaiting_round_advance: false, red_score: 2 });
});

test('with the network up, the round-break screen does not close and open again while the bout is read', async ({
  page,
}) => {
  const stub = await openBestOf(page);
  await startAndHalt(page);
  await expect.poll(() => stub.sent).toEqual(['POST /clock start', 'POST /clock halt']);
  // The server takes the hit at once, and its row is read only later.
  const read = gate();
  stub.holdRow = read.closed;

  await plusTwo(page, 'red').click();

  await expect(roundBreak(page)).toContainText(/round 1 complete/i);
  // The hit has left the tablet, and the bout's row on screen is the old one:
  // the middle of the race. The screen keeps the round closed.
  await expect.poll(() => stub.sent.at(-1)).toBe('POST /exchanges');
  await expect.poll(() => queuedOnTablet(page)).toBe(0);
  // Long enough for the screen to draw the empty queue over the old row.
  await page.waitForTimeout(400);
  await expect(roundBreak(page)).toContainText(/round 1 complete/i);
  await expect(roundBreak(page)).toContainText('2 – 0');
  await expect(notConfirmedRound(page)).toBeVisible();
  await expect(plusTwo(page, 'red')).toBeDisabled();

  read.open();

  // The server's row has the round closed: the line goes, the screen stays.
  await expect(notConfirmedRound(page)).toHaveCount(0);
  await expect(roundBreak(page)).toContainText(/round 1 complete/i);
  await expect(roundBreak(page)).toContainText('2 – 0');
});

test('while the queue goes out, a round closed on the tablet keeps its score and its winner', async ({
  page,
}) => {
  const stub = await openBestOf(page);
  stub.network = 'down';
  await startAndHalt(page);
  await plusTwo(page, 'red').click();
  await startNextRound(page).click();
  await plusOne(page, 'blue').click();
  const tally = page.getByTestId('round-tally');
  await expect(page.getByText(/round 2/i).first()).toBeVisible();
  await expect(tally).toHaveAttribute('data-red', '1');

  // The network is back, and the bout's row is read only when the test lets it.
  const read = gate();
  stub.holdRow = read.closed;
  await comeBackOnline(page, stub);
  await expect.poll(() => stub.sent).toHaveLength(5);
  await expect.poll(() => queuedOnTablet(page)).toBe(0);
  await page.waitForTimeout(400);

  // Every row is taken, and the row on screen is from before the bout: the
  // screen stays in round 2, with round 1 to red.
  await expect(page.getByText(/round 2/i).first()).toBeVisible();
  await expect(roundBreak(page)).toHaveCount(0);
  await expect(tally).toHaveAttribute('data-red', '1');
  await expect(tally).toHaveAttribute('data-blue', '0');

  read.open();
  await expect(page.getByText(/round 2/i).first()).toBeVisible();
  await expect(roundBreak(page)).toHaveCount(0);
  expect(stub.row).toMatchObject({ current_round: 2, red_round_wins: 1, blue_score: 1 });
});
