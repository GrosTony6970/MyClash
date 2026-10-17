import { test, expect, type Page } from '@playwright/test';
import { runContext } from './_context';
import { apiFor, type Api } from './_api';
import { ensurePersons } from './_bracket';
import { createPoolTournament, readPoolMatches, type PoolMatch } from './_pool';

/**
 * "Next match" with no network reaches the next bout, on the real pad under its
 * real service worker (quick-win ruling 4; the operator ruled that the tablet
 * keeps its whole piste).
 *
 * A referee signs in with a PIN and opens the first bout of the piste. The
 * tablet reads the whole piste behind the screen. The network goes. The Next
 * tile opens the second bout, a bout this tablet never opened: its PAGE comes
 * from the shell the worker kept at install, and the bout from the tablet's
 * copy. It is started and scored there, and it names the third bout as its
 * Next. The app opened again with no network opens the piste, not sign-in
 * (operator, 2026-10-13). When the network is back the server learns of it.
 *
 * `tests/a11y/pad-next-bout-no-network.spec.ts` holds the same story on a
 * stubbed server, where service workers are blocked: the page of bout 2 comes
 * from the dev server there. Only this spec, and the probe recorded in
 * ARCHITECTURE 10.4, run the worker.
 *
 * It needs the STAFF address (`E2E_STAFF_URL`): a PIN session's piste pages
 * push root addresses (`/lices/…`), which leave the admin mount
 * (`<admin>/staff/…`); the piste stays for PIN sessions on the staff address.
 *
 * WRITTEN BY READING THE CODE, on 2026-10-13, when the deployed build was
 * older than this work. Read its first run as a first run.
 */
const STAFF_URL = (process.env.E2E_STAFF_URL ?? '').replace(/\/$/, '');
const PIN = '481902';

test('with no network the Next tile opens a bout the tablet never opened, and it is scored', async ({
  browser,
  request,
}) => {
  test.skip(
    !STAFF_URL,
    'set E2E_STAFF_URL: the piste of a PIN session runs on the staff address only',
  );
  test.setTimeout(300_000);
  const api = apiFor(request);
  const { eventId, eventSlug } = runContext();
  const piste = await aPisteOfThreeBouts(api, eventId);
  const [first, second, third] = piste.order;

  // A browser with no organiser cookie: the PIN session is what reads the piste.
  const context = await browser.newContext({ storageState: undefined, ignoreHTTPSErrors: true });
  try {
    const page = await context.newPage();
    await signInWithPin(page, eventSlug, piste.username);
    // Through the piste's list, as on the day: the tablet remembers its piste and keeps the list.
    await page.goto(`${STAFF_URL}/lices/${piste.liceId}`);
    await expect(page.getByTestId('lice-title')).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(() => kept(page, `lice-matches/${piste.liceId}`), { timeout: 30_000 })
      .not.toBeNull();
    await page.goto(`${STAFF_URL}/matches/${first}`);
    const pad = padOf(page);
    await expect(pad.primary).toBeEnabled({ timeout: 30_000 });

    // With the network: the worker holds the bout shell, the tablet its piste.
    await expect.poll(() => shellIsKept(page), { timeout: 60_000 }).toBe(true);
    await expect
      .poll(() => kept(page, `piste/${piste.liceId}`), { timeout: 60_000 })
      .toEqual([first, second, third]);
    await expect.poll(() => kept(page, `bout/${second}`), { timeout: 30_000 }).not.toBeNull();

    await context.setOffline(true);
    await pad.linkTo(second).click();
    await expect(page).toHaveURL(new RegExp(`/matches/${second}$`), { timeout: 30_000 });
    await expect(pad.fromTablet, 'bout 2 is the tablet’s copy, and says so').toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText(/could not check/i), 'not the start page').toHaveCount(0);

    await startPauseAndScore(page, pad, second);
    await expect(pad.linkTo(third), 'bout 2 names bout 3 as its Next').toBeVisible();
    expect((await serverBout(api, second)).status, 'the server has heard nothing').toBe(
      'scheduled',
    );

    // The app opened with no network (operator, 2026-10-13): its last piste, not sign-in.
    await page.goto(`${STAFF_URL}/`);
    await expect(page).toHaveURL(new RegExp(`/lices/${piste.liceId}$`), { timeout: 30_000 });
    await expect(page.getByTestId('lice-from-tablet'), 'the list is the tablet’s copy').toBeVisible(
      {
        timeout: 30_000,
      },
    );

    await context.setOffline(false);
    await expect.poll(() => queued(page, second), { timeout: 60_000 }).toBe(0);
    await expect
      .poll(async () => (await serverBout(api, second)).status, { timeout: 30_000 })
      .not.toBe('scheduled');
    const exchanges = await api.json<unknown[]>(await api.get(`matches/${second}/exchanges`));
    expect(exchanges, 'the hit scored with no network is on the server').toHaveLength(1);
  } finally {
    await context.close();
  }
});

interface Piste {
  liceId: string;
  username: string;
  /** The three bouts in the order the pad's tiles walk them. */
  order: [string, string, string];
}

/** A piste with one Pool of three fighters on it, and a PIN account assigned to it. */
async function aPisteOfThreeBouts(api: Api, eventId: string): Promise<Piste> {
  const token = Date.now().toString(36);
  const username = `next${token}`.slice(0, 20);
  const lice = await api.json<{ id: string }>(
    await api.post(`events/${eventId}/lices`, { data: { name: `Next bout ${token}` } }),
  );
  const account = await api.json<{ id: string }>(
    await api.post(`events/${eventId}/staff-accounts`, {
      data: { displayName: `E2E Next ${token}`, username, pin: PIN, role: 'scoring' },
    }),
  );
  await api.ok(
    await api.put(`events/${eventId}/staff-accounts/${account.id}/lices`, {
      data: { liceIds: [lice.id] },
    }),
  );
  const tournament = await createPoolTournament(api, eventId, {
    name: `Next bout ${token}`,
    slug: `next-bout-${token}`,
    fighters: (await ensurePersons(api, eventId, 3)).slice(0, 3),
    poolCount: 1,
  });
  const bouts = (await readPoolMatches(api, tournament.id)).filter(
    (bout: PoolMatch) => bout.red_registration_id && bout.blue_registration_id,
  );
  expect(bouts, 'a Pool of three fighters has three bouts').toHaveLength(3);
  for (const bout of bouts) {
    await api.ok(await api.patch(`matches/${bout.id}/schedule`, { data: { liceId: lice.id } }));
  }
  return { liceId: lice.id, username, order: await orderOnPiste(api, bouts[0]!.id) };
}

interface Neighbours {
  previous: { id: string } | null;
  next: { id: string } | null;
}

/** The three bouts as the SERVER orders them on their piste: the order the tiles walk. */
async function orderOnPiste(api: Api, anyBout: string): Promise<[string, string, string]> {
  const of = async (id: string) => api.json<Neighbours>(await api.get(`matches/${id}/neighbors`));
  let first = anyBout;
  for (let previous = (await of(first)).previous; previous; previous = (await of(first)).previous) {
    first = previous.id;
  }
  const second = (await of(first)).next?.id;
  const third = second ? (await of(second)).next?.id : undefined;
  if (!second || !third) throw new Error('the piste does not hold three bouts in a row');
  return [first, second, third];
}

const serverBout = async (api: Api, id: string) =>
  api.json<{ status: string }>(await api.get(`matches/${id}`));

/** The pad's own sign-in page, through the link an organiser hands out. */
async function signInWithPin(page: Page, eventSlug: string, username: string): Promise<void> {
  await page.goto(
    `${STAFF_URL}/login?event=${encodeURIComponent(eventSlug)}&u=${encodeURIComponent(username)}`,
  );
  await expect(page.locator('#staffUsername')).toHaveValue(username, { timeout: 30_000 });
  await page.fill('#staffPin', PIN);
  await page.locator('form:has(#staffPin) button[type="submit"]').click();
  // The session, not the landing address: the landing depends on the role.
  await expect
    .poll(async () => (await page.request.get(`${STAFF_URL}/api/v1/staff-auth/me`)).status(), {
      timeout: 30_000,
      message: 'the PIN login never produced a staff session',
    })
    .toBe(200);
}

/** The pad's controls this story presses and reads. */
function padOf(page: Page) {
  return {
    clock: page.getByTestId('clock-status'),
    primary: page.getByTestId('clock-primary-button'),
    double: page.getByTestId('double-button'),
    fromTablet: page.getByTestId('bout-from-tablet'),
    linkTo: (matchId: string) => page.locator(`a[href$="/matches/${matchId}"]`).first(),
  };
}

/** Start, Pause, one double: all on the tablet, nothing sent (ruling 14). */
async function startPauseAndScore(
  page: Page,
  pad: ReturnType<typeof padOf>,
  matchId: string,
): Promise<void> {
  await pad.primary.click();
  await expect(pad.clock).toHaveAttribute('data-status', 'running');
  await pad.primary.click();
  await expect(pad.clock).toHaveAttribute('data-status', 'halted');
  await pad.double.click();
  await expect.poll(() => queued(page, matchId)).toBe(3);
}

/** The worker holds the shell that serves any bout with no network. */
function shellIsKept(page: Page): Promise<boolean> {
  return page.evaluate(async () => Boolean(await caches.match('/matches/_')));
}

/** The body of one row of the tablet's `reads` table, or null with no row. */
function kept(page: Page, key: string): Promise<unknown> {
  return page.evaluate(
    (path) =>
      new Promise<unknown>((resolve) => {
        const open = indexedDB.open('myclash-staff');
        open.onerror = () => resolve('the store did not open');
        open.onsuccess = () => {
          const get = open.result.transaction('reads').objectStore('reads').get(path);
          get.onsuccess = () => {
            const row = get.result as { body?: unknown } | undefined;
            open.result.close();
            resolve(row ? (row.body ?? '') : null);
          };
        };
      }),
    key,
  );
}

/** How many entries the tablet's queue holds for a bout. */
function queued(page: Page, matchId: string): Promise<number> {
  return page.evaluate(
    (id) =>
      new Promise<number>((resolve) => {
        const open = indexedDB.open('myclash-staff');
        open.onerror = () => resolve(-1);
        open.onsuccess = () => {
          const all = open.result.transaction('outbox').objectStore('outbox').getAll();
          all.onsuccess = () => {
            open.result.close();
            const rows = all.result as Array<{ matchId?: string }>;
            resolve(rows.filter((entry) => entry.matchId === id).length);
          };
        };
      }),
    matchId,
  );
}
