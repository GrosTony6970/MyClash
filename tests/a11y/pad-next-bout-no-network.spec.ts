/**
 * "Next match" with no network reaches the next bout (quick-win ruling 4; the
 * operator ruled that the tablet keeps its whole piste).
 *
 * The wifi drops at a piste for forty minutes. Bout 1 ends and the official
 * goes to the next bout. The tablet held a copy of a bout only after its own
 * screen had read it, so bout 2 said "not loaded" and the table stopped. Now
 * the tablet reads its whole piste while the wifi is good, and bout 2 opens
 * from that copy, can be started and scored, and names bout 3 as its Next.
 *
 * Only a live page proves what the official reads. The unit tests hold the
 * read, the copies and their race (`piste-read.test.ts`, `keep-piste.test.ts`,
 * `kept-piste.test.ts`). The API is stubbed (`pad-piste-stub.ts`); the service
 * worker is not in play here, so the page of bout 2 comes from the dev server.
 */
import { test, expect, type Page } from '@playwright/test';
import { keptRow, openFirstBout, queuedFor, LICE, ORDER } from './pad-piste-stub';

const fromTablet = (page: Page) => page.getByTestId('bout-from-tablet');
const nextTile = (page: Page, name: RegExp) => page.getByRole('link', { name });

test('opening a bout keeps every bout of its piste on the tablet', async ({ page }) => {
  const stub = await openFirstBout(page);

  // A bout this tablet never opened, with its names: what its screen will show.
  await expect
    .poll(() => keptRow(page, 'bout/match-3'))
    .toMatchObject({ id: 'match-3', redFighterName: 'Eli Third', liceId: LICE });
  expect(await keptRow(page, `piste/${LICE}`)).toEqual(ORDER);
  expect(stub.pisteReads).toBeGreaterThan(0);
  // A read, and nothing else: no bout of the piste was written to.
  expect(stub.sent).toEqual([]);
});

test('with no network the Next tile opens the next bout from the tablet, and it is scored', async ({
  page,
}) => {
  const stub = await openFirstBout(page);
  await expect.poll(() => keptRow(page, 'bout/match-2')).not.toBeNull();

  stub.network = 'down';
  await nextTile(page, /Cy After/).click();

  await expect(page).toHaveURL(/\/matches\/match-2$/);
  await expect(fromTablet(page)).toBeVisible();
  await expect(page.locator('main')).toContainText('Cy After');
  await expect(page.locator('main')).toContainText('Di After');

  // Ruling 14: a bout never started may be started with no network.
  const clockButton = page.getByTestId('clock-primary-button');
  await expect(clockButton).toHaveAttribute('data-action', 'start');
  await clockButton.click();
  // A hit is entered on a halted clock.
  await expect(clockButton).toHaveAttribute('data-action', 'halt');
  await clockButton.click();
  await expect(page.getByTestId('double-button')).toBeEnabled();
  await page.getByTestId('double-button').click();

  // The Start, the Halt and the hit wait on the tablet; nothing reached the server.
  await expect.poll(() => queuedFor(page, 'match-2')).toBe(3);
  expect(stub.sent).toEqual([]);
});

test('a bout opened from the tablet names its own next bout, to the end of the piste', async ({
  page,
}) => {
  const stub = await openFirstBout(page);
  await expect.poll(() => keptRow(page, 'bout/match-3')).not.toBeNull();

  stub.network = 'down';
  await nextTile(page, /Cy After/).click();
  await expect(fromTablet(page)).toBeVisible();

  // The server cannot say the neighbours of bout 2: the tablet's order does.
  await expect(nextTile(page, /Eli Third/)).toHaveAttribute('href', '/matches/match-3');
  await expect(nextTile(page, /Ana Red/)).toHaveAttribute('href', '/matches/match-1');

  await nextTile(page, /Eli Third/).click();
  await expect(page).toHaveURL(/\/matches\/match-3$/);
  await expect(fromTablet(page)).toBeVisible();
  await expect(page.locator('main')).toContainText('Fay Third');
  // The last bout of the piste: a Previous, and no Next.
  await expect(nextTile(page, /Cy After/)).toHaveAttribute('href', '/matches/match-2');
  await expect(page.getByRole('link', { name: /Ana Red|Eli Third/ })).toHaveCount(0);
});

// The bout carries its own rules, but its Tournament's display does not ride
// with it: a copy with the default side colours over the Tournament's own is a
// hit given to the wrong side. So the tablet keeps no bout of a Tournament
// whose `/match-config` it does not hold, and says "not loaded".
test('a bout whose Tournament’s display the tablet does not hold is not opened from the tablet', async ({
  page,
}) => {
  const stub = await openFirstBout(page, { rules: false });
  expect(await keptRow(page, 'bout/match-2')).toBeNull();

  stub.network = 'down';
  // The order is kept, so the way to the next bout is still on screen.
  await nextTile(page, /Cy After/).click();

  await expect(page).toHaveURL(/\/matches\/match-2$/);
  await expect(page.getByTestId('bout-not-loaded')).toBeVisible();
  await expect(fromTablet(page)).toHaveCount(0);
});

// The race: the read of the piste is the slow one. The bout screen keeps a
// newer bout 1 while that read is on its way; its answer must not put the
// older bout 1 back.
test('an answer of the piste does not replace a copy the bout screen wrote after it was asked', async ({
  page,
}) => {
  const stub = await openFirstBout(page);
  const readsBefore = stub.pisteReads;

  // The piste is asked again, and its answer is held: it says red has 3.
  stub.holdPiste = true;
  stub.pisteRedScore = 3;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect.poll(() => stub.pisteReads).toBeGreaterThan(readsBefore);

  // A hit is saved meanwhile (the stub's score goes to 4). The bout screen
  // reads bout 1 again and keeps it.
  await page.getByTestId('double-button').click();
  await expect
    .poll(() => keptRow(page, 'bout/match-1'))
    .toMatchObject({ id: 'match-1', redScore: 4 });

  // The held answer lands. In the middle: bout 2 of that answer is kept again...
  await page.evaluate(() =>
    indexedDB.open('myclash-staff').addEventListener('success', (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      db.transaction('reads', 'readwrite').objectStore('reads').delete('bout/match-2');
      db.close();
    }),
  );
  await expect.poll(() => keptRow(page, 'bout/match-2')).toBeNull();
  stub.releasePiste();
  await expect.poll(() => keptRow(page, 'bout/match-2')).not.toBeNull();
  // ...and bout 1 is still the newer one.
  expect(await keptRow(page, 'bout/match-1')).toMatchObject({ redScore: 4 });
});
