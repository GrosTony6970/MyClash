import { expect, test, type Page } from '@playwright/test';

const WEB_PUBLIC_URL = 'http://localhost:3001';
const WEB_SCORING_URL = 'http://localhost:3002';
const WEB_ADMIN_URL = 'http://localhost:3003';
const LCP_BUDGET_MS = 2_500;
const CLS_BUDGET = 0.1;

declare global {
  interface Window {
    __myclashLcp?: number;
    __myclashCls?: number;
  }
}

async function measureVitals(
  page: Page,
  baseUrl: string,
  path: string,
): Promise<{ lcp: number; cls: number }> {
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
    window.__myclashCls = 0;

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

    try {
      new PerformanceObserver((entryList) => {
        for (const entry of entryList.getEntries()) {
          const layoutShift = entry as PerformanceEntry & {
            hadRecentInput?: boolean;
            value?: number;
          };
          if (!layoutShift.hadRecentInput) {
            window.__myclashCls = (window.__myclashCls ?? 0) + (layoutShift.value ?? 0);
          }
        }
      }).observe({ type: 'layout-shift', buffered: true });
    } catch {
      window.__myclashCls = 0;
    }
  });

  await page.goto(`${baseUrl}${path}`, { waitUntil: 'load' });
  await page.waitForTimeout(1_000);

  const vitals = await page.evaluate(() => {
    const paintFallback = performance
      .getEntriesByType('paint')
      .find((entry) => entry.name === 'first-contentful-paint');
    return {
      lcp: window.__myclashLcp || paintFallback?.startTime || 0,
      cls: window.__myclashCls ?? 0,
    };
  });

  await client.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });
  await client.detach();

  return vitals;
}

test.describe('web app performance budgets', () => {
  test('web-public landing Web Vitals stay under budget', async ({ page }) => {
    await expect(page.goto(WEB_PUBLIC_URL)).resolves.toBeTruthy();

    const { lcp, cls } = await measureVitals(page, WEB_PUBLIC_URL, '/');

    expect(lcp).toBeGreaterThan(0);
    expect(lcp).toBeLessThan(LCP_BUDGET_MS);
    expect(cls).toBeLessThanOrEqual(CLS_BUDGET);
  });

  test('web-public event page Web Vitals stay under budget', async ({ page }) => {
    const { lcp, cls } = await measureVitals(page, WEB_PUBLIC_URL, '/e/fal-2026');

    expect(lcp).toBeGreaterThan(0);
    expect(lcp).toBeLessThan(LCP_BUDGET_MS);
    expect(cls).toBeLessThanOrEqual(CLS_BUDGET);
  });

  test('web-admin unauthenticated shell Web Vitals stay under budget', async ({ page }) => {
    const { lcp, cls } = await measureVitals(page, WEB_ADMIN_URL, '/');

    expect(lcp).toBeGreaterThan(0);
    expect(lcp).toBeLessThan(LCP_BUDGET_MS);
    expect(cls).toBeLessThanOrEqual(CLS_BUDGET);
  });

  test('web-scoring shell Web Vitals stay under budget', async ({ page }) => {
    const { lcp, cls } = await measureVitals(page, WEB_SCORING_URL, '/');

    expect(lcp).toBeGreaterThan(0);
    expect(lcp).toBeLessThan(LCP_BUDGET_MS);
    expect(cls).toBeLessThanOrEqual(CLS_BUDGET);
  });
});
