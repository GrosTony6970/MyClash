/**
 * Two ways a best-of bout on the tablet meets the server (the offline bout,
 * slice 4b; both found by the review of the screen).
 *
 * (1) The tablet closes a round the server does not close, and NOTHING is
 * refused: the hits are all taken, and no "Start round" was tapped. The screen
 * must go back to the server's open round when the bout is read, and not keep
 * its own closed round for ever.
 *
 * (2) A series decided on the tablet has a clock that the tablet only halted.
 * It must take no Resume, no "End round" and no Space: the server would refuse
 * that press on a completed bout, and hold it in the inbox.
 *
 * The API is stubbed (`pad-rounds-stub.ts`). `showSeries` has the unit tests
 * (`pad-series.shown.test.ts`).
 */
import { test, expect } from '@playwright/test';
import {
  comeBackOnline,
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

test('a round the tablet closed and the server did not: the screen goes back to the open round when the bout is read', async ({
  page,
}) => {
  // The server closes a round at 3. The network is up all the time.
  const stub = await openBestOf(page, { serverCap: 3 });
  await startAndHalt(page);

  await plusTwo(page, 'red').click();

  // The server took the hit and its round 1 is open at 2-0: nothing is refused.
  await expect.poll(() => stub.sent.at(-1)).toBe('POST /exchanges');
  await expect.poll(() => queuedOnTablet(page)).toBe(0);
  await expect(roundBreak(page)).toHaveCount(0);
  await expect(notConfirmedRound(page)).toHaveCount(0);
  await expect(held(page)).toHaveCount(0);
  await expect(page.getByText(/round 1/i).first()).toBeVisible();
  // The round is in play: the official scores on.
  await expect(plusOne(page, 'red')).toBeEnabled();
  expect(stub.row).toMatchObject({ current_round: 1, awaiting_round_advance: false, red_score: 2 });

  // One more point takes the server's round: now the server closes it.
  await plusOne(page, 'red').click();
  await expect(roundBreak(page)).toContainText(/round 1 complete/i);
  await expect(roundBreak(page)).toContainText('3 – 0');
  await expect(notConfirmedRound(page)).toHaveCount(0);
});

test('the official takes back the hit that decided the series: round 2 is in play again', async ({
  page,
}) => {
  const stub = await openBestOf(page);
  stub.network = 'down';
  await startAndHalt(page);
  await plusTwo(page, 'red').click();
  await startNextRound(page).click();
  await plusTwo(page, 'red').click();
  await expect(result(page)).toBeVisible();
  await result(page).getByRole('button', { name: 'Close' }).click();
  await expect(status(page)).toHaveAttribute('data-status', 'ended');

  await page.getByTestId('undo-last-entry').click();

  // The deciding hit is off the tablet: the series is not decided any more.
  await expect.poll(() => queuedOnTablet(page)).toBe(4);
  await expect(status(page)).toHaveAttribute('data-status', 'halted');
  await expect(primary(page)).toHaveAttribute('data-action', 'resume');
  await expect(plusTwo(page, 'red')).toBeEnabled();
  await expect(page.getByTestId('round-tally')).toHaveAttribute('data-red', '1');
  await expect(page.getByText(/round 2/i).first()).toBeVisible();

  // The undo stops at round 1, closed on the tablet with "Start round 2" behind it.
  await page.getByTestId('undo-last-entry').click();
  await expect(
    page.getByRole('alert').filter({ hasText: /closed with their round/i }),
  ).toBeVisible();
  await expect.poll(() => queuedOnTablet(page)).toBe(4);
});

test('a series decided on the tablet takes no clock press: no Resume, no "End round", no Space', async ({
  page,
}) => {
  const stub = await openBestOf(page);
  stub.network = 'down';
  await startAndHalt(page);
  await plusTwo(page, 'red').click();
  await startNextRound(page).click();
  await plusTwo(page, 'red').click();
  await expect(result(page)).toBeVisible();

  // Space behind the result screen, then on the bout once the screen is closed.
  await page.keyboard.press('Space');
  await result(page).getByRole('button', { name: 'Close' }).click();
  await expect(result(page)).toHaveCount(0);
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Space');

  // The clock is ended on the screen: Re-open is a person's, with the network.
  await expect(status(page)).toHaveAttribute('data-status', 'ended');
  await expect(primary(page)).toHaveAttribute('data-action', 'reopen');
  await expect(primary(page)).toBeDisabled();
  await expect(page.getByTestId('clock-end-button')).toHaveCount(0);
  await expect(plusTwo(page, 'red')).toBeDisabled();
  // The result stays closed: nothing made the clock leave "ended".
  await expect(result(page)).toHaveCount(0);

  await comeBackOnline(page, stub);

  // The bout as it happened, and no press after its deciding hit.
  await expect
    .poll(() => stub.sent)
    .toEqual([
      'POST /clock start',
      'POST /clock halt',
      'POST /exchanges',
      'POST /rounds/advance 2',
      'POST /exchanges',
    ]);
  await expect.poll(() => queuedOnTablet(page)).toBe(0);
  await expect(held(page)).toHaveCount(0);
  expect(stub.row.status).toBe('completed');
});
