/**
 * The referees under a Pool on the public Tournament page name their role as the public site
 * does everywhere: the name the organiser gave it, or a plain "Referee".
 *
 * The page kept its own map of role ids: a role it did not know (a club's own skill, deleted
 * since) printed its raw id, "custom-8f2a", and a referee with no role an English "Referee".
 * The page reads on the SERVER: `scripts/e2e-server-api-stub.mjs` answers `rapier-pools`, one
 * Pool with two referees.
 */
import { test, expect, type Page } from '@playwright/test';
import { stubPublicApi, waitForPageMain } from './helpers';
import { PUBLIC } from './public-pages-stub';

async function openPoolList(page: Page, tab: string) {
  await stubPublicApi(page);
  // The Pool bouts and standings tabs read on the client: no bout and no standing yet.
  await page.route('**/tournaments/rapier-pools/pools-with-matches', (route) =>
    route.fulfill({ json: { pools: [] } }),
  );
  await page.route('**/pool-standings?mode=overall', (route) =>
    route.fulfill({
      json: { rulesetCode: 'TF_v1', rulesetVersion: '1.0.0', columns: [], rows: [] },
    }),
  );
  await page.goto(`${PUBLIC}/e/test-event/t/rapier-pools`);
  await waitForPageMain(page);
  await page.getByRole('tab', { name: tab }).click();
}

test('a Pool\'s referees name their role, and a deleted role reads "Referee", never its id', async ({
  page,
}) => {
  await openPoolList(page, 'Pool list');

  const footer = page.locator('footer', { hasText: 'Rita Ref' });
  await expect(footer.getByText('Arbitre déclarant', { exact: true })).toBeVisible();
  await expect(footer.getByText('Referee', { exact: true })).toBeVisible();
  await expect(page.getByText(/custom-8f2a|arbitre_declarant/)).toHaveCount(0);
});

test('a French visitor reads a role with no name as "Arbitre"', async ({ page }) => {
  await page.context().addCookies([{ name: 'mc_locale', value: 'fr', url: PUBLIC }]);
  await openPoolList(page, 'Liste des poules');

  const footer = page.locator('footer', { hasText: 'Hugo Ref' });
  await expect(footer.getByText('Arbitre', { exact: true })).toBeVisible();
});
