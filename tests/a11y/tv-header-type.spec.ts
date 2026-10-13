/**
 * The white header of the TV scoreboard is sized for a hall (quick win T3).
 *
 * The names of the next two fighters were 14px on a 1080p TV, and the Event,
 * the piste and the Tournament line 12 to 14px: phone sizes, at fifteen metres.
 * They now use the stage scale, which follows the width of the screen.
 *
 * The API is stubbed (`tv-stub.ts`). A size is what the browser computed.
 */
import { test, expect, type Page } from '@playwright/test';
import { BOUT, openPisteTv } from './tv-stub';

/** The computed type size of the element that holds this text, to the pixel. */
async function sizeOf(page: Page, text: string): Promise<number> {
  const size = await page
    .getByText(text)
    .first()
    .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  return Math.round(size);
}

test.describe('on a 1080p TV', () => {
  test.use({ viewport: { width: 1920, height: 1080 } });

  test('the next two fighters are named in 30px, under a 16px label', async ({ page }) => {
    await openPisteTv(page);
    await expect(page.getByText('Grace Hopper')).toBeVisible();

    expect(await sizeOf(page, 'Grace Hopper')).toBe(30);
    expect(await sizeOf(page, 'Emmy Noether')).toBe(30);
    expect(await sizeOf(page, 'Up next')).toBe(16);
  });

  test('the name of the Event is in 18px', async ({ page }) => {
    await openPisteTv(page);
    await expect(page.getByText('Grace Hopper')).toBeVisible();

    expect(await sizeOf(page, '◇ Open de Lyon')).toBe(18);
  });

  // A name left to wrap made the header taller, and the card counts under the
  // fighters left the bottom of the screen.
  test('two long names in the next-up tile do not make the header taller', async ({ page }) => {
    await openPisteTv(page);
    await expect(page.getByText('Grace Hopper')).toBeVisible();
    const usual = (await page.locator('header').boundingBox())?.height;

    await openPisteTv(page, {
      bout: {
        ...BOUT,
        nextMatch: {
          ...BOUT.nextMatch,
          redFighterName: 'Marie-Antoinette Deschamps-Villeneuve de la Tour',
          blueFighterName: 'Aleksandra Wojciechowska-Kowalczyk-Nowakowska',
        },
      },
    });
    await expect(page.getByText('Aleksandra')).toBeVisible();

    expect((await page.locator('header').boundingBox())?.height).toBe(usual);
  });

  // Two long fighters take the middle of the header, and leave the Event's name
  // little room: it is cut on its line too.
  test('a long Event name beside two long fighters stays on one line', async ({ page }) => {
    await openPisteTv(page);
    const oneLine = (await page.getByText('◇ Open de Lyon').boundingBox())?.height;

    await openPisteTv(page, {
      bout: {
        ...BOUT,
        redFighterName: 'Jean-Baptiste de la Fontaine-Beauregard',
        blueFighterName: 'Maximilian von Hohenzollern-Sigmaringen',
        event: { name: 'Rencontres internationales d’escrime historique de Lyon et du Rhône' },
      },
    });
    await expect(page.getByText('Maximilian').first()).toBeVisible();

    expect((await page.getByText('◇ Rencontres').boundingBox())?.height).toBe(oneLine);
  });

  test('the piste and the Tournament line are in 18px too', async ({ page }) => {
    await openPisteTv(page);
    await expect(page.getByText('Grace Hopper')).toBeVisible();

    expect(await sizeOf(page, 'Longsword · Pool A · Piste 1')).toBe(18);
    // The piste alone, under the Event's name.
    const piste = page.locator('header').getByText('Piste 1', { exact: true });
    expect(
      await piste.evaluate((el) => Math.round(parseFloat(getComputedStyle(el).fontSize))),
    ).toBe(18);
  });
});

test.describe('in a 720p window', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test('the names follow the width of the screen', async ({ page }) => {
    await openPisteTv(page);
    await expect(page.getByText('Grace Hopper')).toBeVisible();

    expect(await sizeOf(page, 'Grace Hopper')).toBe(20);
  });
});
