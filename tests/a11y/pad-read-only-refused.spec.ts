/**
 * A refused entry in read-only mode: the bar is red (operator, 2026-10-13).
 *
 * The server refused a hit of bout 1: it waits in the inbox, for the official.
 * Then the organiser switches read-only mode on. The official starts bout 2,
 * the Start is kept on the tablet, and the bar went grey ("maintenance"), as if
 * nothing needed the official. With no network the bar was red already; now it
 * is red here too, and says both.
 *
 * The API is stubbed: a piste of three bouts (`pad-piste-stub.ts`), and this
 * spec answers the two bouts itself (a route registered after the stub's
 * answers first). The rule has its unit tests (`lib/held-press.test.ts`), and
 * the send engine its own (`offline/sync.no-network.test.ts`).
 */
import { test, expect, type Page } from '@playwright/test';
import { PAD, openFirstBout } from './pad-piste-stub';

const bar = (page: Page) => page.getByTestId('network-bar');
const problem = (status: number, code: string) => ({
  status,
  contentType: 'application/problem+json',
  body: JSON.stringify({ status, code, detail: 'API words', message: 'API words' }),
});

/** Bout 1 holds a hit the server refused; bout 2 is open, and read-only mode is on. */
async function refusedThenReadOnly(page: Page) {
  await openFirstBout(page);
  await page.route('**/matches/match-1/exchanges', (route) =>
    route.request().method() === 'POST'
      ? route.fulfill(problem(409, 'match_locked'))
      : route.fallback(),
  );
  await page.getByTestId('double-button').click();
  await expect(bar(page)).toHaveAttribute('data-rejected', '1');

  // Read-only mode refuses every save of bout 2 with its own 503.
  await page.route('**/matches/match-2/**', (route) =>
    route.request().method() === 'GET'
      ? route.fallback()
      : route.fulfill(problem(503, 'read_only_mode')),
  );
  await page.goto(`${PAD}/matches/match-2`);
  await expect(page.getByTestId('clock-primary-button')).toHaveAttribute('data-action', 'start');
}

test('a refused entry in read-only mode: the bar is red, says both, and offers Review', async ({
  page,
}) => {
  await refusedThenReadOnly(page);

  await page.getByTestId('clock-primary-button').click();

  await expect(bar(page)).toHaveAttribute('data-sync', 'maintenance');
  await expect(bar(page)).toHaveAttribute('data-rejected', '1');
  await expect(bar(page)).toHaveClass(/text-danger/);
  await expect(bar(page)).toContainText(/not recorded.*maintenance/i);
  await expect(page.getByTestId('review-refused')).toBeVisible();
  // Nothing tells the tablet that read-only mode ended: its Retry stays.
  await expect(bar(page).getByRole('button', { name: /retry/i })).toBeVisible();
});

test('read-only mode with no refused entry stays grey', async ({ page }) => {
  await openFirstBout(page);
  await page.route('**/matches/match-2/**', (route) =>
    route.request().method() === 'GET'
      ? route.fallback()
      : route.fulfill(problem(503, 'read_only_mode')),
  );
  await page.goto(`${PAD}/matches/match-2`);
  await expect(page.getByTestId('clock-primary-button')).toHaveAttribute('data-action', 'start');

  await page.getByTestId('clock-primary-button').click();

  await expect(bar(page)).toHaveAttribute('data-sync', 'maintenance');
  await expect(bar(page)).toHaveClass(/text-muted/);
  await expect(bar(page)).not.toHaveClass(/text-danger/);
  await expect(page.getByTestId('review-refused')).toHaveCount(0);
});
