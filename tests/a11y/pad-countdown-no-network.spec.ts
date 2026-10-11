/**
 * A bout that counts down, on the tablet (operator ruling of 2026-10-11).
 *
 * Countdown, first to lose 2: each fighter starts at 2, a hit takes its points
 * off the OPPONENT, and the fighter at zero loses the round. A table has no
 * wifi and red hits for 1: the tablet reads 2 – 1 at once, as the server will.
 *
 * The API is stubbed (`pad-rounds-stub.ts` keeps the rounds as the server
 * does, and `pad-rounds-score.ts` counts a round down). The score of a round
 * on the pad has the unit tests (`pad-series.countdown.test.ts`).
 */
import { test, expect, type Page } from '@playwright/test';
import { comeBackOnline, openBestOf, plusOne, startAndHalt } from './pad-rounds-stub';

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
