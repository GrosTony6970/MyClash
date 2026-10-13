/**
 * A TV screen does not sleep, and it can go to fullscreen (quick win T5).
 *
 * The laptop that drives the hall's TV went to sleep in the middle of a Pool,
 * and nothing on the screen put it in fullscreen. The TV screens now ask the
 * browser to keep the screen awake, and the hidden bar of the piste TV has a
 * Fullscreen button.
 *
 * Fullscreen is the browser's own here, not a record of a request: the claim
 * is that it HOLDS when the screen moves to the next bout, and only the real
 * thing can say so. The wake lock is a record (`wake-lock-recorder.ts`). The
 * API is stubbed (`tv-stub.ts`).
 */
import { test, expect, type Page } from '@playwright/test';
import { BOARD, ENDED, ENDED_BOUT, NEXT_BOUT, openPisteTv } from './tv-stub';
import { recordWakeLock, wake } from './wake-lock-recorder';

const inFullscreen = (page: Page) => page.evaluate(() => document.fullscreenElement !== null);

/** The bar shows when the screen is touched. */
async function settingsBar(page: Page) {
  await page.mouse.move(400, 400);
  await page.mouse.move(420, 420);
  const bar = page.getByTestId('display-controls');
  await expect(bar).toHaveAttribute('aria-hidden', 'false');
  return bar;
}

test('the piste TV keeps the screen awake on a bout', async ({ page }) => {
  await recordWakeLock(page);
  await openPisteTv(page);
  await expect(page.getByText('Ada Lovelace').first()).toBeVisible();

  await expect.poll(() => wake(page)).toEqual({ held: 1, kinds: ['screen'] });
});

test('the piste TV keeps the screen awake on its waiting card', async ({ page }) => {
  await recordWakeLock(page);
  await openPisteTv(page, { board: { ...BOARD, current: null, queue: [] } });
  await expect(page.getByText(/waiting for next match/i)).toBeVisible();

  await expect.poll(() => wake(page)).toEqual({ held: 1, kinds: ['screen'] });
});

test('a tap on Fullscreen fills the screen, and it holds when the bout ends', async ({ page }) => {
  const board = await openPisteTv(page, { bout: ENDED_BOUT, clock: ENDED });
  await expect(page.getByText('Match ended')).toBeVisible();
  expect(await inFullscreen(page)).toBe(false);

  const bar = await settingsBar(page);
  await bar.getByRole('button', { name: 'Fullscreen', exact: true }).click();

  await expect.poll(() => inFullscreen(page)).toBe(true);
  // The button's words now say the way out.
  await expect(bar.getByRole('button', { name: 'Exit fullscreen' })).toBeVisible();
  await expect(bar.getByRole('button', { name: 'Fullscreen', exact: true })).toHaveCount(0);

  // The piste now names the bout that waited: the countdown takes the screen there.
  board.answer = { ...BOARD, current: { id: NEXT_BOUT.id } };
  await expect(page.getByText('Not started', { exact: true })).toBeVisible({ timeout: 12_000 });

  expect(await inFullscreen(page)).toBe(true);

  // And out of it again, with the same button.
  await (await settingsBar(page)).getByRole('button', { name: 'Exit fullscreen' }).click();
  await expect.poll(() => inFullscreen(page)).toBe(false);
});
