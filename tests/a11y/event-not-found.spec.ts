/**
 * A wrong link says "Page not found", and only a wrong link does (quick win F13).
 *
 * The read of an Event answered nothing for a missing Event, a server fault and
 * a dead network alike, and the pages drew themselves with the Event left out:
 * a near-blank page with no way back. The site had no not-found page either.
 *
 * These pages read on the SERVER: `scripts/e2e-server-api-stub.mjs` answers
 * them. `no-such-event` is a 404, `broken-event` a 500, and `draft-event` is
 * shown only to a request that carries a login, as the API shows a draft to a
 * member of its club.
 */
import { test, expect, type Page } from '@playwright/test';
import { expectNoCriticalAxeViolations, stubPublicApi, waitForPageMain } from './helpers';
import { PUBLIC } from './public-pages-stub';

const notFound = (page: Page) => page.getByRole('heading', { name: 'Page not found' });

/** How many times the page itself was asked of the server: a load, and each load again. */
function countLoads(page: Page): () => number {
  let loads = 0;
  page.on('request', (request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) loads += 1;
  });
  return () => loads;
}

test('an Event that is not there says so, and offers the list of Events', async ({ page }) => {
  await stubPublicApi(page);
  await page.goto(`${PUBLIC}/e/no-such-event/home`);
  await waitForPageMain(page);

  await expect(notFound(page)).toBeVisible();
  await expect(page.getByText('Check the link or the QR code.')).toBeVisible();
  // The Event's own home is the missing page: it is not offered as the way back.
  const main = page.getByRole('main');
  await expect(main.getByRole('link')).toHaveCount(1);
  await expect(main.getByRole('link', { name: 'Back to public events' })).toHaveAttribute(
    'href',
    '/',
  );
  await expectNoCriticalAxeViolations(page);
});

test('a French visitor reads it in French', async ({ page, context }) => {
  await context.addCookies([{ name: 'mc_locale', value: 'fr', url: PUBLIC }]);
  await stubPublicApi(page);
  await page.goto(`${PUBLIC}/e/no-such-event/home`);

  await expect(page.getByRole('heading', { name: 'Page introuvable' })).toBeVisible();
});

for (const path of ['home', 'tournaments', 'participants', 'workshops', 'schedule/tournaments']) {
  test(`a server fault on /${path} offers "Try again", and never says "not found"`, async ({
    page,
  }) => {
    await stubPublicApi(page);
    await page.goto(`${PUBLIC}/e/broken-event/${path}`);

    const alert = page.getByRole('alert').filter({ hasText: 'Try again' });
    await expect(alert.getByRole('button', { name: 'Try again' })).toBeVisible();
    await expect(notFound(page)).toHaveCount(0);
  });

  test(`a missing Event is not found on /${path} too`, async ({ page }) => {
    await stubPublicApi(page);
    await page.goto(`${PUBLIC}/e/no-such-event/${path}`);

    await expect(notFound(page)).toBeVisible();
  });
}

test('a draft Event is not found for a visitor with no login', async ({ page }) => {
  await stubPublicApi(page);
  await page.goto(`${PUBLIC}/e/draft-event/home`);

  await expect(notFound(page)).toBeVisible();
  await expect(page.getByText('Tournoi de Nancy')).toHaveCount(0);
});

test('a club member sees the home of their draft Event, with its Tournaments', async ({
  page,
  context,
}) => {
  await context.addCookies([{ name: 'sb-access-token', value: 'a-login', url: PUBLIC }]);
  await stubPublicApi(page);
  await page.goto(`${PUBLIC}/e/draft-event/home`);
  await waitForPageMain(page);

  await expect(page.getByRole('heading', { name: 'Tournoi de Nancy' })).toBeVisible();
  // The lists are read with the login too: the stub refuses them without it.
  await expect(page.locator('a[href="/e/draft-event/t/longsword-open"]')).toBeVisible();
  await expect(page.getByRole('link', { name: /registered/ })).toBeVisible();
  await expect(notFound(page)).toHaveCount(0);
});

/**
 * The login cookie lasts an hour; the cookie that renews it, thirty days. A
 * club member who comes back after lunch sends the server a login that ended,
 * and only the browser can renew it (`/me`).
 */
test.describe('a club member whose login ended an hour ago', () => {
  test.beforeEach(async ({ context }) => {
    await context.addCookies([{ name: 'sb-refresh-token', value: 'a-renewal', url: PUBLIC }]);
  });

  test('sees her draft Event: the login is renewed, and the page is read again', async ({
    page,
    context,
  }) => {
    await stubPublicApi(page);
    // `/me` waits for the story, so the story reads the page while nobody has answered yet.
    let renew = () => {};
    const renewed = new Promise<void>((resolve) => (renew = resolve));
    await page.route('**/api/v1/me', async (route) => {
      await renewed;
      // What `/me` does: it writes the renewed login into the browser.
      await context.addCookies([{ name: 'sb-access-token', value: 'a-login', url: PUBLIC }]);
      return route.fulfill({ json: { type: 'claimed' } });
    });
    await page.goto(`${PUBLIC}/e/draft-event/home`);

    // Not a "not found" that may be false: the page waits.
    await expect(page.getByRole('main').getByRole('status', { name: 'Loading...' })).toBeVisible();
    await expect(notFound(page)).toHaveCount(0);

    renew();
    await expect(page.getByRole('heading', { name: 'Tournoi de Nancy' })).toBeVisible();
    await expect(notFound(page)).toHaveCount(0);
  });

  // The Tournament page drew its own "Tournament not found", which renewed nothing: her club's
  // draft Tournament stayed "not found" until she signed in again.
  test("sees her club's draft Tournament: the login is renewed, and the page is read again", async ({
    page,
    context,
  }) => {
    await stubPublicApi(page);
    await page.route('**/api/v1/me', async (route) => {
      await context.addCookies([{ name: 'sb-access-token', value: 'a-login', url: PUBLIC }]);
      return route.fulfill({ json: { type: 'claimed' } });
    });
    await page.goto(`${PUBLIC}/e/test-event/t/sabre-draft`);

    await expect(page.getByRole('heading', { name: 'Sabre', level: 1 })).toBeVisible();
    await expect(notFound(page)).toHaveCount(0);
  });

  test('reads "Page not found" with no more load when the login could not be renewed', async ({
    page,
  }) => {
    await stubPublicApi(page);
    const loads = countLoads(page);
    await page.goto(`${PUBLIC}/e/draft-event/home`);

    await expect(notFound(page)).toBeVisible();
    expect(loads()).toBe(1);
  });

  test('reads "Page not found" after ONE more load, for an Event that is not hers', async ({
    page,
  }) => {
    await stubPublicApi(page);
    const loads = countLoads(page);
    // The login is good, and the server still answers "not found".
    await page.route('**/api/v1/me', (route) => route.fulfill({ json: { type: 'claimed' } }));
    await page.goto(`${PUBLIC}/e/draft-event/home`);

    await expect(notFound(page)).toBeVisible();
    expect(loads()).toBe(2);
  });
});

test('a bout that is not there offers the Event home and the list of Events', async ({ page }) => {
  await stubPublicApi(page);
  await page.goto(`${PUBLIC}/e/test-event/match/no-such-bout`);

  await expect(notFound(page)).toBeVisible();
  const main = page.getByRole('main');
  await expect(main.getByRole('link', { name: 'Back to event home' })).toHaveAttribute(
    'href',
    '/e/test-event/home',
  );
  await expect(main.getByRole('link', { name: 'Back to public events' })).toHaveAttribute(
    'href',
    '/',
  );
});

test('an address no page answers is not found too', async ({ page }) => {
  await stubPublicApi(page);
  await page.goto(`${PUBLIC}/no/such/page`);

  await expect(notFound(page)).toBeVisible();
});
