/**
 * The lines that say "is it sent?" are read at arm's length (quick win P14;
 * operator, 2026-10-12).
 *
 * "includes 1 not yet sent" under the score was 11px, and "not confirmed", the
 * messages of the clock and of the undo were 12px. They are 14px. The other
 * captions of the screen stay as they were.
 *
 * The API is stubbed (`pad-clock-stub.ts`). The classes of the lines a story
 * does not reach are pinned as text (`sync-lines.screens.test.ts`).
 */
import { test, expect, type Locator } from '@playwright/test';
import { openBout, primary, redHit } from './pad-clock-stub';

const fontSize = (line: Locator) => line.evaluate((el) => getComputedStyle(el).fontSize);

test('the line under a score that holds an unsent hit is 14px', async ({ page }) => {
  const stub = await openBout(page);
  await primary(page).click();
  await primary(page).click();
  await expect.poll(() => stub.sent).toEqual(['POST /clock start', 'POST /clock halt']);

  stub.network = 'down';
  await redHit(page).first().click();

  const line = page.getByTestId('provisional-score');
  await expect(line).toContainText(/not yet sent/i);
  expect(await fontSize(line)).toBe('14px');
});
