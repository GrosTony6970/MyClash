import { test, expect, type Page } from '@playwright/test';
import { runContext } from './_context';
import { apiFor, type Api } from './_api';
import { ensurePersons } from './_bracket';
import { createPoolTournament, readPoolMatches, type PoolMatch } from './_pool';
import { aScheduledTeamBout } from './_team';

/**
 * A whole bout with no network, on the real pad under its real service worker
 * (the offline bout, operator rulings 9 to 14 of the quick-win list).
 *
 * `06-offline-sync.spec.ts` scores on a bout the server already holds as running, and
 * never touches the clock. Since the clock runs on the tablet, a table with no
 * wifi starts the bout, pauses, scores, and ends it; a reload in the middle
 * opens the bout from the tablet's own copy. The server learns all of it, in
 * the order it happened, when the network is back.
 *
 * The stubbed browser stories (`tests/a11y/pad-clock-on-tablet.spec.ts`,
 * `pad-bout-from-tablet.spec.ts`) block service workers, so the reload with no
 * network is proved nowhere else.
 *
 * WRITTEN BY READING THE CODE, on 2026-10-12, when the deployed build was
 * older than the offline bout. Read its first run as a first run.
 */
test('a whole bout runs with no network, and reaches the server when it is back', async ({
  page,
  context,
  request,
}) => {
  test.setTimeout(180_000);
  const api = apiFor(request);
  const { eventId, baseURL } = runContext();
  const staffBase = (process.env.E2E_STAFF_URL ?? `${baseURL}/staff`).replace(/\/$/, '');
  const bout = await aScheduledPoolBout(api, eventId);
  const serverBout = async () => api.json<ServerBout>(await api.get(`matches/${bout.id}`));
  const pad = padOf(page);

  await openOnceOnline(page, pad, `${staffBase}/matches/${bout.id}`);
  await context.setOffline(true);
  await expect(pad.bar).toHaveAttribute('data-network', 'offline', { timeout: 15_000 });
  await startPauseAndScore(page, pad);
  await reloadOntoTheCopy(page, pad, 4);
  await endOnTheTablet(page, pad, 5);
  // The server has heard nothing: the bout was never started there.
  expect((await serverBout()).status).toBe('scheduled');

  await context.setOffline(false);
  await expect.poll(() => queuedKinds(page), { timeout: 30_000 }).toEqual([]);
  await expect.poll(async () => (await serverBout()).status, { timeout: 30_000 }).toBe('completed');
  const ended = await serverBout();
  expect({ red: ended.red_score, blue: ended.blue_score }).toEqual({ red: 4, blue: 0 });
  expect(ended.winner_registration_id).toBe(bout.red_registration_id);
  const exchanges = await api.json<unknown[]>(await api.get(`matches/${bout.id}/exchanges`));
  expect(exchanges).toHaveLength(2);
  const clock = await api.json<{ status: string }>(await api.get(`matches/${bout.id}/clock`));
  expect(clock.status).toBe('ended');
  await expect(pad.unconfirmed, 'the server confirmed the result').toHaveCount(0);
});

/**
 * The same bout with two teams on it (slice 1b-2): a team Pool bout started, scored, carded and
 * ended with no network. The pad derives each corner's side from the bout (`sideOf`), so the
 * card names the blue team and the result names the red team, never a Registration.
 */
test('a team bout runs with no network, and its card and its winner name the teams', async ({
  page,
  context,
  request,
}) => {
  test.setTimeout(180_000);
  const api = apiFor(request);
  const { eventId, baseURL } = runContext();
  const staffBase = (process.env.E2E_STAFF_URL ?? `${baseURL}/staff`).replace(/\/$/, '');
  const { bout } = await aScheduledTeamBout(api, eventId, 'offline-bout');
  const serverBout = async () => api.json<ServerBout>(await api.get(`matches/${bout.id}`));
  const pad = padOf(page);

  await openOnceOnline(page, pad, `${staffBase}/matches/${bout.id}`);
  await context.setOffline(true);
  await expect(pad.bar).toHaveAttribute('data-network', 'offline', { timeout: 15_000 });
  await pad.primary.click();
  await expect(pad.clock).toHaveAttribute('data-status', 'running');
  await pad.primary.click();
  await expect(pad.clock).toHaveAttribute('data-status', 'halted');
  await pad.redHit.click();
  await expect.poll(() => queuedKinds(page)).toEqual(['press', 'press', 'exchange']);
  await aYellowCardTo(page, 'blue', 'Left the piste');
  await expect.poll(() => queuedKinds(page)).toEqual(['press', 'press', 'exchange', 'penalty']);
  await pad.redHit.click();
  await expect
    .poll(() => queuedKinds(page))
    .toEqual(['press', 'press', 'exchange', 'penalty', 'exchange']);
  await reloadOntoTheCopy(page, pad, 5);
  await endOnTheTablet(page, pad, 6);
  expect((await serverBout()).status).toBe('scheduled');

  await context.setOffline(false);
  await expect.poll(() => queuedKinds(page), { timeout: 30_000 }).toEqual([]);
  await expect.poll(async () => (await serverBout()).status, { timeout: 30_000 }).toBe('completed');
  const ended = await serverBout();
  expect({ red: ended.red_score, blue: ended.blue_score }).toEqual({ red: 4, blue: 0 });
  expect({ team: ended.winner_team_id, registration: ended.winner_registration_id }).toEqual({
    team: bout.red_team_id,
    registration: null,
  });
  const cards = await api.json<Array<{ team_id: string | null; registration_id: string | null }>>(
    await api.get(`matches/${bout.id}/penalties`),
  );
  expect(cards.map((card) => ({ team: card.team_id, registration: card.registration_id }))).toEqual(
    [{ team: bout.blue_team_id, registration: null }],
  );
  await expect(pad.unconfirmed, 'the server confirmed the result').toHaveCount(0);
});

interface ServerBout {
  status: string;
  red_score: number | null;
  blue_score: number | null;
  winner_registration_id: string | null;
  winner_team_id: string | null;
}

/**
 * Opened once with a network: the tablet now holds its copy of the bout, and its service worker
 * is in charge and holds the bout shell.
 */
async function openOnceOnline(
  page: Page,
  pad: ReturnType<typeof padOf>,
  url: string,
): Promise<void> {
  await page.goto(url);
  await expect(pad.bar).toHaveAttribute('data-network', 'online', { timeout: 30_000 });
  await expect(pad.primary).toBeEnabled({ timeout: 30_000 });
  await expect(pad.clock).toHaveAttribute('data-status', 'idle');
  // The worker keeps the shells at its first install while the page runs: with
  // no network before it is in charge AND holds the bout shell, the reload
  // below has nothing to open. A first install takes over even with misses.
  await expect
    .poll(
      () =>
        page.evaluate(
          async () =>
            Boolean(navigator.serviceWorker.controller) &&
            Boolean(await caches.match(location.pathname.replace(/[^/]+$/, '_'))),
        ),
      { timeout: 30_000 },
    )
    .toBe(true);
}

/** A direct yellow card from the corrections drawer: given at the tap, kept in the queue. */
async function aYellowCardTo(page: Page, corner: 'red' | 'blue', reason: string): Promise<void> {
  await page.getByTestId('open-corrections').click();
  const reasonField = page.getByTestId('direct-card-reason');
  // The corner picker sits beside the reason, in the panel's one grid.
  await reasonField.locator('xpath=ancestor::div[1]').locator('select').selectOption(corner);
  await reasonField.fill(reason);
  const yellow = page.locator('[data-testid="direct-card-button"][data-card="yellow"]');
  await yellow.click();
  await expect(yellow, 'the drawer closes at once').toHaveCount(0);
}

/** One Pool bout of two fighters that nobody started: the server says "scheduled". */
async function aScheduledPoolBout(api: Api, eventId: string): Promise<PoolMatch> {
  const token = Date.now().toString(36);
  const tournament = await createPoolTournament(api, eventId, {
    name: `Offline bout ${token}`,
    slug: `offline-bout-${token}`,
    fighters: (await ensurePersons(api, eventId, 2)).slice(0, 2),
    poolCount: 1,
  });
  const bout = (await readPoolMatches(api, tournament.id)).find(
    (match) => match.red_registration_id && match.blue_registration_id,
  );
  if (!bout) throw new Error('no playable Pool bout was generated');
  expect(bout.status).toBe('scheduled');
  return bout;
}

/** The pad's controls this story presses and reads. */
function padOf(page: Page) {
  return {
    bar: page.getByTestId('network-bar'),
    clock: page.getByTestId('clock-status'),
    primary: page.getByTestId('clock-primary-button'),
    redHit: page
      .locator('[data-testid="scoring-column"][data-side="red"]')
      .getByTestId('clean-hit-button')
      .filter({ hasText: '+2' })
      .first(),
    fromTablet: page.getByTestId('bout-from-tablet'),
    unconfirmed: page.getByTestId('match-result-unconfirmed'),
    result: page.getByTestId('match-result-overlay'),
  };
}

/** What the tablet's queue holds, in order (`press`, `exchange`, `penalty`), read from the store. */
function queuedKinds(page: Page): Promise<string[]> {
  return page.evaluate(
    () =>
      new Promise<string[]>((resolve) => {
        const open = indexedDB.open('myclash-staff');
        open.onerror = () => resolve(['the store did not open']);
        open.onsuccess = () => {
          const rows = open.result.transaction('outbox').objectStore('outbox').getAll();
          rows.onsuccess = () => {
            open.result.close();
            resolve((rows.result as Array<{ kind?: string }>).map((row) => row.kind ?? 'exchange'));
          };
        };
      }),
  );
}

/** Start, Pause, two hits of 2 for red: all on the tablet, nothing sent. */
async function startPauseAndScore(page: Page, pad: ReturnType<typeof padOf>): Promise<void> {
  await pad.primary.click();
  await expect(pad.clock).toHaveAttribute('data-status', 'running');
  await pad.primary.click();
  await expect(pad.clock).toHaveAttribute('data-status', 'halted');
  await pad.redHit.click();
  await expect.poll(() => queuedKinds(page)).toEqual(['press', 'press', 'exchange']);
  await pad.redHit.click();
  await expect.poll(() => queuedKinds(page)).toEqual(['press', 'press', 'exchange', 'exchange']);
}

/** The official reloads by mistake: the bout opens from the tablet's copy, in play, and says so. */
async function reloadOntoTheCopy(
  page: Page,
  pad: ReturnType<typeof padOf>,
  queued: number,
): Promise<void> {
  await page.reload();
  await expect(pad.fromTablet).toBeVisible({ timeout: 30_000 });
  await expect(pad.clock).toHaveAttribute('data-status', 'halted');
  await expect(pad.redHit, 'the bout can still be scored').toBeEnabled();
  expect(await queuedKinds(page), 'the queue survived the reload').toHaveLength(queued);
}

/** "End match" before the time, with a leader: the pad asks, then shows its own result. */
async function endOnTheTablet(
  page: Page,
  pad: ReturnType<typeof padOf>,
  queued: number,
): Promise<void> {
  await page.getByTestId('clock-end-button').click();
  await page.getByTestId('end-early-confirm').click();
  await expect(pad.result).toBeVisible();
  await expect(pad.unconfirmed, 'ended on this tablet, not confirmed').toBeVisible();
  await expect(page.getByTestId('match-result-score')).toHaveText('4 – 0');
  expect(await queuedKinds(page)).toHaveLength(queued);
}
