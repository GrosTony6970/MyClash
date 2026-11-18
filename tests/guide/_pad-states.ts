import { expect, type Page } from '@playwright/test';
import type { Api } from '../e2e/_api';

/**
 * Drives one bout on the scoring pad through every state the guide's pad
 * reference shows, and saves a screenshot of each: running with two hits,
 * paused with a penalty search, the corrections drawer, the network cut, and
 * ended. Selectors come from tests/e2e/16-pad-ui.spec.ts.
 *
 * Split out of screenshots.spec.ts for the 400-line file budget
 * (quality:complexity). The caller sets the tablet viewport.
 */
export async function shootPadStates(
  page: Page,
  api: Api,
  matchId: string,
  staffBase: string,
  out: string,
): Promise<void> {
  const pad = padOf(page, api, matchId, out);
  await page.goto(`${staffBase}/matches/${matchId}`);
  await expect(pad.network).toHaveAttribute('data-network', 'online');
  await shootScoring(page, pad);
  await shootOfflineAndEnd(page, pad);
}

type Pad = ReturnType<typeof padOf>;

function padOf(page: Page, api: Api, matchId: string, out: string) {
  const column = (side: 'red' | 'blue') =>
    page.locator(`[data-testid="scoring-column"][data-side="${side}"]`);
  return {
    column,
    cleanHit: (side: 'red' | 'blue', label: string) =>
      column(side).getByTestId('clean-hit-button').filter({ hasText: label }).first(),
    primaryClock: page.getByTestId('clock-primary-button'),
    clockStatus: page.getByTestId('clock-status'),
    network: page.getByTestId('network-bar'),
    exchanges: async (): Promise<number> =>
      (await api.json<unknown[]>(await api.get(`matches/${matchId}/exchanges`))).length,
    shot: async (name: string) => {
      await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => undefined);
      await page.screenshot({ path: `${out}/${name}.png` });
    },
  };
}

/** Start, pause, two hits, resume; then paused with a penalty search; then the drawer. */
async function shootScoring(page: Page, pad: Pad): Promise<void> {
  await pad.primaryClock.click(); // Start
  await expect(pad.clockStatus).toHaveAttribute('data-status', 'running');
  await pad.primaryClock.click(); // Pause
  await expect(pad.clockStatus).toHaveAttribute('data-status', 'halted');
  await pad.cleanHit('red', '+2').click();
  await pad.cleanHit('blue', '+1').click();
  await expect.poll(pad.exchanges).toBe(2);
  await pad.primaryClock.click(); // Resume
  await expect(pad.clockStatus).toHaveAttribute('data-status', 'running');
  await pad.shot('13-pad-running');

  await pad.primaryClock.click(); // Pause
  await expect(pad.clockStatus).toHaveAttribute('data-status', 'halted');
  const penaltySearch = pad.column('red').getByPlaceholder('Search penalties');
  await penaltySearch.scrollIntoViewIfNeeded();
  await penaltySearch.fill('e');
  await pad.shot('13-pad-penalties');
  await penaltySearch.fill('');
  await page.evaluate(() => window.scrollTo(0, 0));

  await page.getByTestId('open-corrections').click();
  await pad.shot('13-pad-corrections');
  await page.keyboard.press('Escape');
}

/**
 * The wifi drops: the bar turns grey. Then it comes back, and the script waits
 * until the tablet has nothing left to send before it ends the bout.
 */
async function shootOfflineAndEnd(page: Page, pad: Pad): Promise<void> {
  await page.context().setOffline(true);
  await expect(pad.network).toHaveAttribute('data-network', 'offline');
  await pad.shot('13-pad-offline');
  await page.context().setOffline(false);
  await expect(pad.network).toHaveAttribute('data-network', 'online');
  await expect(pad.network).not.toContainText('queued', { timeout: 30_000 });
  expect(await pad.exchanges(), 'the two hits reached the server').toBe(2);

  await page.getByTestId('clock-end-button').click();
  const endEarly = page.getByTestId('end-early-confirm');
  if (await endEarly.isVisible().catch(() => false)) await endEarly.click();
  await expect(page.getByTestId('match-result-overlay')).toBeVisible();
  await pad.shot('13-pad-ended');
}
