/**
 * A bout that counts down, on the tablet (operator ruling of 2026-10-11).
 *
 * Countdown, first to lose 2: each fighter starts at 2, a hit takes its points
 * off the OPPONENT, and the fighter at zero loses the round. A table has no
 * wifi and red hits for 1: the tablet reads 2 – 1 at once, as the server will.
 * A best-of bout runs to its end there, as a bout that counts up does: the
 * tablet closes a round when a fighter is at zero, and "Start round 2" puts
 * both fighters back at the cap.
 *
 * The API is stubbed (`pad-rounds-stub.ts` keeps the rounds as the server
 * does, and `pad-rounds-score.ts` counts a round down). The score of a round
 * on the pad has the unit tests (`pad-series.countdown.test.ts`).
 */
import { test, expect, type Page } from '@playwright/test';
import {
  comeBackOnline,
  gate,
  held,
  notConfirmedRound,
  openBestOf,
  plusOne,
  plusTwo,
  queuedOnTablet,
  result,
  roundBreak,
  startAndHalt,
  startNextRound,
} from './pad-rounds-stub';

const column = (page: Page, side: 'red' | 'blue') =>
  page.locator(`[data-testid="scoring-column"][data-side="${side}"]`);
/** A side's large number. */
const numeral = (page: Page, side: 'red' | 'blue') => column(page, side).locator('p').first();
/** The small line under a side's number: what the tablet holds of it. */
const notSent = (page: Page, side: 'red' | 'blue') =>
  column(page, side).getByTestId('provisional-score');

test('a countdown bout reads cap to cap before its first hit, and an unsent hit takes its points off the opponent', async ({
  page,
}) => {
  const stub = await openBestOf(page, { countdown: true });
  // Nobody has hit: the server's row says 0-0, and both fighters hold the cap.
  expect(stub.row).toMatchObject({ red_score: 0, blue_score: 0 });
  await expect(numeral(page, 'red')).toHaveText('2');
  await expect(numeral(page, 'blue')).toHaveText('2');

  await startAndHalt(page);
  await expect.poll(() => stub.sent).toEqual(['POST /clock start', 'POST /clock halt']);
  stub.network = 'down';

  await plusOne(page, 'red').click();

  // Red's hit is on blue's number, and red keeps the cap.
  await expect(numeral(page, 'blue')).toHaveText('1');
  await expect(numeral(page, 'red')).toHaveText('2');
  await expect(notSent(page, 'blue')).toHaveAttribute('data-provisional-delta', '-1');
  await expect(notSent(page, 'red')).toHaveCount(0);

  await comeBackOnline(page, stub);

  // The server counts the same, and nothing is left to send.
  await expect
    .poll(() => stub.sent)
    .toEqual(['POST /clock start', 'POST /clock halt', 'POST /exchanges']);
  await expect(notSent(page, 'blue')).toHaveCount(0);
  expect(stub.row).toMatchObject({ red_score: 2, blue_score: 1 });
  await expect(numeral(page, 'blue')).toHaveText('1');
  await expect(numeral(page, 'red')).toHaveText('2');
});

test('with no network a best-of-3 that counts down runs to its end on the tablet, and goes to the server in its own order', async ({
  page,
}) => {
  const stub = await openBestOf(page, { countdown: true });
  stub.network = 'down';
  await startAndHalt(page);

  // Red takes blue to zero in two hits: the tablet closes round 1 by itself.
  await plusOne(page, 'red').click();
  await expect(numeral(page, 'blue')).toHaveText('1');
  await expect(roundBreak(page)).toHaveCount(0);
  await plusOne(page, 'red').click();
  await expect(roundBreak(page)).toContainText(/round 1 complete/i);
  await expect(roundBreak(page)).toContainText('Ana Red');
  await expect(roundBreak(page)).toContainText('2 – 0');
  await expect(notConfirmedRound(page)).toHaveText('Closed on this tablet, not confirmed.');

  // "Start round 2": both fighters are back at the cap, and the round is in play.
  await startNextRound(page).click();
  await expect(roundBreak(page)).toHaveCount(0);
  await expect(page.getByText(/round 2/i).first()).toBeVisible();
  await expect(numeral(page, 'red')).toHaveText('2');
  await expect(numeral(page, 'blue')).toHaveText('2');
  await expect(plusTwo(page, 'red')).toBeEnabled();

  // Blue takes one off red, then red takes blue to zero: 1 – 0, and the series
  // is decided on the tablet.
  await plusOne(page, 'blue').click();
  await expect(numeral(page, 'red')).toHaveText('1');
  await plusTwo(page, 'red').click();
  await expect(result(page)).toBeVisible();
  await expect(page.getByTestId('match-result-unconfirmed')).toContainText(/not confirmed/i);
  await expect(page.getByTestId('match-result-winner')).toContainText('Ana Red');
  await expect(page.getByTestId('match-result-score')).toHaveText('2 – 0');
  await expect(page.getByTestId('match-result-rounds')).toHaveText(
    'Points per round: 2 – 0 · 1 – 0',
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
      'POST /exchanges',
      'POST /rounds/advance 2',
      'POST /exchanges',
      'POST /exchanges',
    ]);
  // The server counted down too, and closed the same rounds for the same fighter.
  expect(stub.row).toMatchObject({
    status: 'completed',
    red_round_wins: 2,
    blue_round_wins: 0,
    current_round: 2,
    red_score: 1,
    blue_score: 0,
  });
  await expect(page.getByTestId('match-result-unconfirmed')).toHaveCount(0);
  await expect(page.getByTestId('match-result-score')).toHaveText('2 – 0');
  await expect(page.getByTestId('match-result-rounds')).toHaveText(
    'Points per round: 2 – 0 · 1 – 0',
  );
  await expect(held(page)).toHaveCount(0);
});

test('with the network up, the first hit of a countdown bout closes its round, and the screen does not open it again while the bout is read', async ({
  page,
}) => {
  const stub = await openBestOf(page, { countdown: true });
  await startAndHalt(page);
  await expect.poll(() => stub.sent).toEqual(['POST /clock start', 'POST /clock halt']);
  // The server takes the hit at once, and its row is read only later.
  const read = gate();
  stub.holdRow = read.closed;

  await plusTwo(page, 'red').click();

  await expect(roundBreak(page)).toContainText(/round 1 complete/i);
  // The hit has left the tablet, and the bout's row on screen is the one from
  // before any hit, at 0-0: the middle of the race. That row reads as a round
  // in play, and the screen keeps the round it closed (`pad-series-memory.ts`).
  await expect.poll(() => stub.sent.at(-1)).toBe('POST /exchanges');
  await expect.poll(() => queuedOnTablet(page)).toBe(0);
  // Long enough for the screen to draw the empty queue over the old row.
  await page.waitForTimeout(400);
  await expect(roundBreak(page)).toContainText(/round 1 complete/i);
  await expect(roundBreak(page)).toContainText('Ana Red');
  await expect(roundBreak(page)).toContainText('2 – 0');
  await expect(notConfirmedRound(page)).toBeVisible();
  await expect(plusTwo(page, 'red')).toBeDisabled();

  read.open();

  // The server's row has the round closed: the line goes, the screen stays.
  await expect(notConfirmedRound(page)).toHaveCount(0);
  await expect(roundBreak(page)).toContainText(/round 1 complete/i);
  await expect(roundBreak(page)).toContainText('2 – 0');
});
