/**
 * The guest schedule says how old it is, and survives a hall with no signal
 * (quick win F10; operator ruling 2026-10-13: the phone keeps a copy, and the
 * copy leaves with its person).
 *
 * The page read once and never said when. A fighter who opened it in the
 * changing room, with no signal, got "could not load". And the copy the
 * personal space kept was never removed: the next person on that phone saw it.
 */
import { test, expect, type Page } from '@playwright/test';
import { stubPublicApi, waitForPageMain } from './helpers';
import { emptySchedule, PUBLIC, scheduledBout } from './public-pages-stub';

const SCHEDULE = { ...emptySchedule, matches: [scheduledBout('M1', '2027-06-12T08:30:00.000Z')] };
const KEY = 'myclash:schedule:test-event';
const copyOnPhone = (page: Page) => page.evaluate((key) => window.localStorage.getItem(key), KEY);

/** The schedule's read, as a story can fail it, refuse it and count it. */
async function openSchedule(page: Page, me: object = { type: 'anonymous' }) {
  const server = { answers: 200, reads: 0 };
  await stubPublicApi(page);
  await page.route('**/api/v1/me', (route) => route.fulfill({ json: me }));
  await page.route('**/api/v1/events/**/my-schedule', (route) => {
    server.reads += 1;
    return server.answers === 200
      ? route.fulfill({ json: SCHEDULE })
      : route.fulfill({ status: server.answers, json: { detail: 'refused' } });
  });
  await page.goto(`${PUBLIC}/e/test-event/my-schedule`);
  await waitForPageMain(page);
  await expect(page.getByText('Ada Lovelace')).toBeVisible();
  return server;
}

test('the schedule says when it was last read', async ({ page }) => {
  await openSchedule(page);

  await expect(page.getByRole('status').filter({ hasText: 'Updated' })).toHaveText(
    /^Updated \d\d:\d\d$/,
  );
});

test('opened again with a server that fails, it shows the copy and says "offline"', async ({
  page,
}) => {
  const server = await openSchedule(page);
  await expect.poll(() => copyOnPhone(page)).not.toBeNull();

  server.answers = 503;
  await page.reload();
  await waitForPageMain(page);

  // Her bout is still there, and the page says it is a copy.
  await expect(page.getByText('Ada Lovelace')).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Updated' })).toHaveText(
    /^Updated \d\d:\d\d · offline$/,
  );
  await expect(page.getByRole('heading', { name: 'We could not load your schedule' })).toHaveCount(
    0,
  );

  // The server is well again and she comes back to the page: it reads, and is fresh.
  server.answers = 200;
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.getByRole('status').filter({ hasText: 'Updated' })).toHaveText(
    /^Updated \d\d:\d\d$/,
  );
});

test('a server that knows nobody here ends the copy: the doors show, not her schedule', async ({
  page,
}) => {
  const server = await openSchedule(page);
  await expect.poll(() => copyOnPhone(page)).not.toBeNull();

  server.answers = 401;
  await page.reload();
  await waitForPageMain(page);

  await expect(page.getByRole('heading', { name: 'Sign in to see your schedule' })).toBeVisible();
  await expect(page.getByText('Ada Lovelace')).toHaveCount(0);
  expect(await copyOnPhone(page)).toBeNull();
});

test('coming back to the page reads the schedule again', async ({ page }) => {
  const server = await openSchedule(page);
  const before = server.reads;

  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));

  await expect.poll(() => server.reads).toBe(before + 1);
});

test('"End guest session" takes her schedule off the phone', async ({ page }) => {
  await openSchedule(page, {
    type: 'guest',
    person: { given_name: 'Grace', family_name: 'Hopper', event_slug: 'test-event' },
  });
  await expect.poll(() => copyOnPhone(page)).not.toBeNull();

  await page.getByRole('button', { name: 'End guest session' }).click();
  await page.waitForURL('**/e/test-event/home');

  expect(await copyOnPhone(page)).toBeNull();
});
