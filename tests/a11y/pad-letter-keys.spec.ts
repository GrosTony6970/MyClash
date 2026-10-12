/**
 * D is the Double button and U is "Undo last entry" (quick win P19; operator,
 * 2026-10-12). A laptop table scores without the mouse; a French laptop has
 * D and U at the same place as an English one.
 *
 * A key presses its button: D does nothing while the Double button is off (a
 * running clock), and neither key does anything while a field has the focus,
 * a dialog is up or the corrections drawer is open.
 *
 * The API is stubbed (`pad-clock-stub.ts`), and the network is down for the
 * hits: the count of doubles is then the tablet's own, at once. Each "does
 * nothing" is proved by the count AFTER the next key that works: a press that
 * slipped through would show there.
 */
import { test, expect, type Page } from '@playwright/test';
import { openBout, primary, redHit, result } from './pad-clock-stub';

const doubles = (page: Page) => page.getByTestId('double-count');
const count = (page: Page, n: number) =>
  expect(doubles(page)).toHaveAttribute('data-count', String(n));
const key = (page: Page, code: string) => page.keyboard.press(code);

/** A bout with its clock halted, then no network: a double is the tablet's own at once. */
async function haltedWithNoNetwork(page: Page) {
  const stub = await openBout(page);
  await key(page, 'Space');
  await expect(primary(page)).toHaveAttribute('data-action', 'halt');
  await key(page, 'Space');
  await expect.poll(() => stub.sent).toEqual(['POST /clock start', 'POST /clock halt']);
  stub.network = 'down';
}

test('the hint under the clock lists the three keys', async ({ page }) => {
  await openBout(page);

  await expect(page.getByTestId('keys-hint')).toHaveText(
    'Keys: Space starts or pauses the clock · D double · U undo last entry',
  );
});

test('D gives a double and U takes the last entry back, when their buttons are live', async ({
  page,
}) => {
  await haltedWithNoNetwork(page);

  await key(page, 'KeyD');
  await count(page, 1);
  await key(page, 'KeyU');
  await count(page, 0);

  // The clock runs: the Double button is off, and so is its key.
  await key(page, 'Space');
  await expect(primary(page)).toHaveAttribute('data-action', 'halt');
  await expect(page.getByTestId('double-button')).toBeDisabled();
  await key(page, 'KeyD');
  await key(page, 'Space');
  await expect(primary(page)).toHaveAttribute('data-action', 'resume');
  await key(page, 'KeyD');
  await count(page, 1);
});

test('U does nothing under the result screen of a bout that has ended', async ({ page }) => {
  await haltedWithNoNetwork(page);
  await redHit(page).first().click();
  // The hit is written: the Double button is live again, and so is its key.
  await expect(page.getByTestId('provisional-score')).toBeVisible();
  await expect(page.getByTestId('double-button')).toBeEnabled();
  await key(page, 'KeyD');
  await count(page, 1);

  await page.getByTestId('clock-end-button').click();
  await page.getByTestId('end-early-confirm').click();
  await expect(result(page)).toBeVisible();
  await expect(result(page)).toHaveAttribute('aria-modal', 'true');

  // The Undo button is under the result screen, and live: the key must not reach it.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await key(page, 'KeyU');
  await result(page)
    .getByRole('button', { name: /^close$/i })
    .click();
  await expect(result(page)).toHaveCount(0);

  // The double is still there. With the screen closed, U takes it back.
  await count(page, 1);
  await key(page, 'KeyU');
  await count(page, 0);
});

test('the keys do nothing in a field, behind a dialog, behind the drawer, or with Ctrl', async ({
  page,
}) => {
  await haltedWithNoNetwork(page);
  await key(page, 'KeyD');
  await count(page, 1);

  // A field has the focus: the letters are typed, and nothing else.
  const search = page.locator('[data-side="red"]').getByTestId('penalty-search');
  await search.focus();
  await page.keyboard.type('du');
  await expect(search).toHaveValue('du');
  await search.fill('');
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

  // A dialog is up.
  await page.getByTestId('no-exchange-button').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await key(page, 'KeyD');
  await key(page, 'KeyU');
  await key(page, 'Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // The corrections drawer is open.
  await page.getByTestId('open-corrections').click();
  await expect(page.getByTestId('reset-match')).toBeVisible();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await key(page, 'KeyD');
  await key(page, 'KeyU');
  await key(page, 'Escape');
  await expect(page.getByTestId('reset-match')).toHaveCount(0);

  // Ctrl+D is the browser's own.
  await key(page, 'Control+KeyD');

  // One double was given before, and none since: D makes it two, U one again.
  await count(page, 1);
  await key(page, 'KeyD');
  await count(page, 2);
  await key(page, 'KeyU');
  await count(page, 1);
});
