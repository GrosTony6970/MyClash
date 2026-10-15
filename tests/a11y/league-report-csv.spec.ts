/**
 * The season report's CSV asks which file (operator, 2026-10-15): Excel in French, `?csv=excel-fr`,
 * or the others, `?csv=standard`.
 *
 * The league page is drawn on the SERVER (`scripts/e2e-server-api-stub.mjs` answers its reads);
 * the menu is its one client part, so this story is the proof that it answers a tap at all. The
 * download is answered here, as the server sends it: an attachment, so the page stays.
 */
import { test, expect } from '@playwright/test';
import { expectNoCriticalAxeViolations, stubPublicApi, waitForPageMain } from './helpers';
import { PUBLIC } from './public-pages-stub';

const LEAGUE = `${PUBLIC}/leagues/lyon-cup`;

test('the season report downloads the file picked, and the page stays', async ({ page }) => {
  await stubPublicApi(page);
  await page.route('**/api/v1/leagues/lg-1/final-report.csv?**', (route) =>
    route.fulfill({
      body: '\uFEFFranking_group;league_rank\r\n',
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="final-report.csv"',
      },
    }),
  );
  await page.goto(LEAGUE);
  await waitForPageMain(page);

  const trigger = page.getByRole('button', { name: /Download final report/ });
  // A tap before the page is live opens nothing: tap until the menu is there.
  await expect(async () => {
    await trigger.click();
    await expect(page.getByRole('menu')).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  await expectNoCriticalAxeViolations(page);

  const download = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: /Excel \(French\)/ }).click();
  expect((await download).url()).toMatch(
    /\/api\/v1\/leagues\/lg-1\/final-report\.csv\?csv=excel-fr$/,
  );
  expect(page.url()).toBe(LEAGUE);
  await expect(page.getByRole('menu')).toBeHidden();
});
