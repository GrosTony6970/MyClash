/**
 * "Swap sides" on the public piste TV (quick win T4).
 *
 * A TV that faces the public shows red on the wrong side for them, and
 * spectators gave a point to the wrong fighter. The organiser's popup could
 * swap the sides; the public piste TV could not. Its hidden bar now has the
 * button, and the screen keeps the choice.
 *
 * The API is stubbed (`tv-stub.ts`). "Left of" is where the browser drew the
 * two names.
 */
import { test, expect, type Page } from '@playwright/test';
import { BOARD, openPisteTv, PISTE_TV } from './tv-stub';

/** Where the browser drew the last element with this text, from the left edge. */
async function leftEdge(page: Page, text: string): Promise<number> {
  const box = await page.getByText(text).last().boundingBox();
  if (!box) throw new Error(`"${text}" is not on screen`);
  return box.x;
}

/** The bar shows when the screen is touched. */
async function swapButton(page: Page) {
  await page.mouse.move(400, 400);
  await page.mouse.move(420, 420);
  const button = page.getByTestId('display-controls').getByRole('button', { name: /swap sides/i });
  await expect(button).toBeVisible();
  return button;
}

test('a tap on Swap sides puts blue on the left, and the screen keeps it', async ({ page }) => {
  await openPisteTv(page);
  await expect(page.getByText('Ada Lovelace').last()).toBeVisible();
  // As it opens: red (Ada) is on the left.
  expect(await leftEdge(page, 'Ada Lovelace')).toBeLessThan(
    await leftEdge(page, 'Mary Somerville'),
  );

  const button = await swapButton(page);
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await button.click();

  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await expect
    .poll(
      async () =>
        (await leftEdge(page, 'Mary Somerville')) < (await leftEdge(page, 'Ada Lovelace')),
    )
    .toBe(true);

  // The page is loaded again: the choice is the screen's, not the page's.
  await page.goto(PISTE_TV);
  await expect(page.getByText('Ada Lovelace').last()).toBeVisible();
  await expect
    .poll(
      async () =>
        (await leftEdge(page, 'Mary Somerville')) < (await leftEdge(page, 'Ada Lovelace')),
    )
    .toBe(true);

  // A second tap puts red back on the left.
  await (await swapButton(page)).click();
  await expect
    .poll(
      async () =>
        (await leftEdge(page, 'Ada Lovelace')) < (await leftEdge(page, 'Mary Somerville')),
    )
    .toBe(true);
});

test('the waiting card names the next two fighters in the swapped order', async ({ page }) => {
  // No bout on the piste: one waits.
  const board = {
    ...BOARD,
    current: null,
    queue: [
      {
        id: 'm-2',
        redFighterName: 'Grace Hopper',
        blueFighterName: 'Emmy Noether',
        roundCode: null,
        matchNumberLabel: 'L1-P1-M02',
        scoringConfig: null,
        tournamentName: 'Longsword',
      },
    ],
  };
  await openPisteTv(page, { board });
  await expect(page.getByText('Grace Hopper')).toBeVisible();
  expect(await leftEdge(page, 'Grace Hopper')).toBeLessThan(await leftEdge(page, 'Emmy Noether'));

  await (await swapButton(page)).click();

  await expect
    .poll(
      async () => (await leftEdge(page, 'Emmy Noether')) < (await leftEdge(page, 'Grace Hopper')),
    )
    .toBe(true);
});
