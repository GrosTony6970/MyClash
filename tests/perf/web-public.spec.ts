import { expect, test, type Page } from '@playwright/test';

const WEB_PUBLIC_URL = 'http://localhost:3001';
const LCP_BUDGET_MS = 2_500;

declare global {
  interface Window {
    __myclashLcp?: number;
  }
}

async function measureLcp(page: Page, path: string): Promise<number> {
  await page.goto(`${WEB_PUBLIC_URL}${path}`, { waitUntil: 'networkidle' });

  const client = await page.context().newCDPSession(page);
  await client.send('Network.enable');
  await client.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 150,
    downloadThroughput: (1_600 * 1024) / 8,
    uploadThroughput: (750 * 1024) / 8,
  });

  await page.addInitScript(() => {
    window.__myclashLcp = 0;

    try {
      new PerformanceObserver((entryList) => {
        const entries = entryList.getEntries();
        const lastEntry = entries.at(-1);
        if (lastEntry) {
          window.__myclashLcp = lastEntry.startTime;
        }
      }).observe({ type: 'largest-contentful-paint', buffered: true });
    } catch {
      window.__myclashLcp = 0;
    }
  });

  await page.goto(`${WEB_PUBLIC_URL}${path}`, { waitUntil: 'load' });
  await page.waitForTimeout(1_000);

  const lcp = await page.evaluate(() => {
    const paintFallback = performance
      .getEntriesByType('paint')
      .find((entry) => entry.name === 'first-contentful-paint');
    return window.__myclashLcp || paintFallback?.startTime || 0;
  });

  await client.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });
  await client.detach();

  return lcp;
}

test.describe('web-public performance budgets', () => {
  test('landing LCP stays under the 4G budget', async ({ page }) => {
    await expect(page.goto(WEB_PUBLIC_URL)).resolves.toBeTruthy();

    const lcp = await measureLcp(page, '/');

    expect(lcp).toBeGreaterThan(0);
    expect(lcp).toBeLessThan(LCP_BUDGET_MS);
  });

  test('event page LCP stays under the 4G budget', async ({ page }) => {
    const lcp = await measureLcp(page, '/e/fal-2026');

    expect(lcp).toBeGreaterThan(0);
    expect(lcp).toBeLessThan(LCP_BUDGET_MS);
  });
});
