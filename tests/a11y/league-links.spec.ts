/**
 * From a rank to the fighter to the bout, without a search (quick win F21).
 *
 * A name in a league's standings was plain text. A fighter's full history had
 * no date, and no line of it could be opened. The recent results opened a bout
 * whose Back link led to the Event's home, not back to the fighter.
 *
 * The league and the fighter are read on the SERVER:
 * `scripts/e2e-server-api-stub.mjs` answers them. The full history is read by
 * the browser, so the story answers it.
 */
import { test, expect, type Page } from '@playwright/test';
import { expectNoCriticalAxeViolations, stubPublicApi, waitForPageMain } from './helpers';
import { PUBLIC } from './public-pages-stub';

// West of Greenwich, a plain day read as a local midnight is the day before.
test.use({ timezoneId: 'America/Los_Angeles' });

const LEAGUE = `${PUBLIC}/leagues/lyon-cup`;
const FIGHTER = `${PUBLIC}/fighters/lea-martin`;
/** The bout's page, with the fighter's page as its way back. */
const BOUT_FROM_FIGHTER = '/e/test-event/match/bout-1?return=%2Ffighters%2Flea-martin';

const historyLine = (id: string, more: object = {}) => ({
  id,
  matchScheduledAt: '2026-03-14T09:00:00.000Z',
  eventId: 'ev-test',
  eventName: 'Open de Lyon',
  eventSlug: 'test-event',
  // A plain day: the Event's first day.
  eventDate: '2026-03-14',
  tournamentId: 't-1',
  tournamentName: 'Longsword Open',
  weapon: 'longsword',
  opponentName: 'Paul Martin',
  ourScore: 5,
  opponentScore: 3,
  outcome: 'win',
  status: 'completed',
  ...more,
});

async function openHistory(page: Page, items: object[], showAll = /Show all matches/) {
  await stubPublicApi(page);
  await page.route('**/api/v1/fighters/lea-martin/matches**', (route) =>
    route.fulfill({ json: { items, total: items.length } }),
  );
  await page.goto(FIGHTER);
  await waitForPageMain(page);
  const lines = page.getByTestId('history-line');
  // A tap before the page is live opens nothing: tap until the history is there.
  await expect(async () => {
    await page.getByRole('button', { name: showAll }).click();
    await expect(lines.first()).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  return lines;
}

test('a ranked name opens the fighter, and a fighter with no public page is plain text', async ({
  page,
}) => {
  await stubPublicApi(page);
  // The dev server compiles a page on its first visit. Since Next 16.4 a compile that a click's
  // navigation sets off rebuilds the open page (Fast Refresh, twice) and drops that navigation:
  // on CI the address stayed on the league past the wait. Compile the fighter's page first,
  // while no page is open to rebuild. A production build compiles nothing on a click.
  await page.request.get(FIGHTER);
  await page.goto(LEAGUE);
  await waitForPageMain(page);

  // The champion's card and the table's row both name her: both are links.
  const lea = page.getByRole('link', { name: 'Léa Martin' });
  await expect(lea).toHaveCount(2);
  for (const link of await lea.all()) {
    await expect(link).toHaveAttribute('href', '/fighters/lea-martin');
  }
  // His page would say "not found": his name is shown, and it leads nowhere.
  await expect(page.getByRole('cell', { name: 'Paul Hidden' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Paul Hidden' })).toHaveCount(0);
  await expectNoCriticalAxeViolations(page);

  await lea.last().click();
  await expect(page).toHaveURL(FIGHTER);
  await expect(page.getByRole('heading', { name: 'Léa Martin', level: 1 })).toBeVisible();
});

test("a line of the full history shows the Event's day and opens the bout", async ({ page }) => {
  const lines = await openHistory(page, [historyLine('bout-1')]);

  await expect(lines).toHaveCount(1);
  await expect(lines.first()).toContainText('Open de Lyon · longsword · 14 Mar 2026');
  await expect(lines.first()).toHaveAttribute('href', BOUT_FROM_FIGHTER);
  await expectNoCriticalAxeViolations(page);

  await lines.first().click();
  await expect(page.getByText('Jean Dupont').first()).toBeVisible();
  // Back returns to the fighter, and says a plain "Back".
  const back = page.getByRole('link', { name: 'Back', exact: true });
  await expect(back).toHaveAttribute('href', '/fighters/lea-martin');
});

test('a French visitor reads the day in French', async ({ page, context }) => {
  await context.addCookies([{ name: 'mc_locale', value: 'fr', url: PUBLIC }]);
  const lines = await openHistory(page, [historyLine('bout-1')], /Voir tous les matches/);

  await expect(lines.first()).toContainText('14 mars 2026');
});

test('a line with no Event address is shown, and is no link', async ({ page }) => {
  const lines = await openHistory(page, [
    historyLine('bout-1'),
    historyLine('bout-old', { eventSlug: '', eventDate: '', opponentName: 'Ada Lovelace' }),
  ]);

  await expect(lines).toHaveCount(2);
  await expect(lines.nth(1)).toContainText('Ada Lovelace');
  await expect(lines.nth(1)).not.toHaveAttribute('href');
  // No day to show: the line ends on the weapon, with no stray separator.
  await expect(lines.nth(1)).toContainText('Open de Lyon · longsword');
  await expect(lines.nth(1)).not.toContainText('longsword ·');
});

// Ruling 2026-10-16: a ranked name read as plain text until hovered, and was one line of text
// high on a phone. It is underlined at all times, and a tap anywhere in 44px of height lands on it.
test('a ranked name looks like a link and is a 44px target, in the card and in the table', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await stubPublicApi(page);
  await page.goto(LEAGUE);
  await waitForPageMain(page);

  const links = await page.getByRole('link', { name: 'Léa Martin' }).all();
  expect(links).toHaveLength(2);
  for (const link of links) {
    await link.scrollIntoViewIfNeeded();
    expect(await link.evaluate((a) => getComputedStyle(a).textDecorationLine)).toContain(
      'underline',
    );
    const box = (await link.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    // The top and the bottom of the target take the tap: nothing clips or covers them.
    for (const y of [box.y + 2, box.y + box.height - 2]) {
      const hit = await page.evaluate(
        ([x, at]) => document.elementFromPoint(x, at)?.closest('a')?.getAttribute('href') ?? null,
        [box.x + Math.min(box.width / 2, 20), y],
      );
      expect(hit).toBe('/fighters/lea-martin');
    }
  }
});

test('a recent result opens its bout, and Back returns to the fighter', async ({ page }) => {
  await stubPublicApi(page);
  await page.goto(FIGHTER);
  await waitForPageMain(page);

  const recent = page.locator(`a[href="${BOUT_FROM_FIGHTER}"]`);
  await expect(recent).toHaveCount(1);
  await expect(recent).toContainText('Paul Martin');
});

// A result of an Event with no address has no page: it was a link to "#", which led nowhere.
test('a recent result with no page to open is shown, and is no link', async ({ page }) => {
  await stubPublicApi(page);
  await page.goto(FIGHTER);
  await waitForPageMain(page);

  await expect(page.getByText('Hugo Blanc')).toBeVisible();
  await expect(page.getByRole('link').filter({ hasText: 'Hugo Blanc' })).toHaveCount(0);
  await expect(page.locator('a[href="#"]')).toHaveCount(0);
});
