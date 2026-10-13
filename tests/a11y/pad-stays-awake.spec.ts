/**
 * The tablet does not sleep while a bout is on its screen (quick win P7).
 *
 * A tablet at a piste went to sleep during a bout, and the official unlocked
 * it while two fighters waited. The bout screen now asks the browser to keep
 * the screen awake, and gives the lock back when the official leaves the bout.
 *
 * A test cannot make a tablet sleep: the browser's wake lock is replaced by a
 * record of what the page asked of it (`wake-lock-recorder.ts`). The API is
 * stubbed (`pad-clock-stub.ts`).
 */
import { test, expect } from '@playwright/test';
import { openBout } from './pad-clock-stub';
import { recordWakeLock, wake } from './wake-lock-recorder';

test('the bout screen keeps the tablet awake, and gives the lock back when it is left', async ({
  page,
}) => {
  await recordWakeLock(page);
  await openBout(page);

  await expect.poll(() => wake(page)).toEqual({ held: 1, kinds: ['screen'] });

  // Back to the list: the same page of the browser, without the bout screen.
  await page
    .locator('header')
    .getByRole('link', { name: /back to match list/i })
    .click();
  await expect(page.getByTestId('clock-primary-button')).toHaveCount(0);

  await expect.poll(() => wake(page)).toEqual({ held: 0, kinds: ['screen'] });
});
