import AxeBuilder from '@axe-core/playwright';
import { expect, type Locator, type Page } from '@playwright/test';

export interface PageIssue {
  type: 'pageerror' | 'console';
  message: string;
}

export function collectPageIssues(page: Page): PageIssue[] {
  const issues: PageIssue[] = [];

  page.on('pageerror', (error) => {
    issues.push({ type: 'pageerror', message: error.message });
  });

  page.on('console', (message) => {
    if (message.type() === 'error') {
      issues.push({ type: 'console', message: message.text() });
    }
  });

  return issues;
}

export async function expectNoPageIssues(issues: PageIssue[]) {
  expect(issues, JSON.stringify(issues, null, 2)).toEqual([]);
}

/**
 * Answer, inside the browser, the API calls a web-public page makes.
 *
 * No API runs in this harness. A call nobody answers fails, the browser logs
 * "Failed to load resource", and `expectNoPageIssues` counts it. On Linux that
 * failure arrives at once; on Windows it takes about two seconds, after the test
 * has ended. So the event home and my-schedule specs passed locally and failed in
 * CI with 4-5 of those errors, every one on the API's address.
 *
 * The flags and `/me` answers carry the API's real shapes: a `{}` flags answer
 * crashes the page, because its readers assume `timeSimulation` is there
 * (`apps/web-public/app/_components/SimulatedTimeBadge.tsx`,
 * `packages/ui/src/hooks/time-simulation.ts`). Every other call gets `{}`.
 * Register a spec's own routes AFTER this call: Playwright tries the last
 * registered route first.
 *
 * The `{}` live-state answer also keeps the event home's realtime channel shut:
 * `LiveNowSection` opens one only for Lices. A spec that answers live-state with
 * Lices makes the page open a socket to the placeholder Supabase host in
 * `scripts/run-e2e.mjs`, which nothing answers.
 */
export async function stubPublicApi(page: Page) {
  await page.route('**/api/**', (route) => route.fulfill({ json: {} }));
  await page.route('**/api/v1/public/feature-flags', (route) =>
    route.fulfill({
      json: {
        maintenanceBanner: { enabled: false, message: null, severity: null },
        realtimeDisabled: false,
        timeSimulation: { enabled: false, simulatedNowIso: null, anchorRealIso: null },
      },
    }),
  );
  // Signed out is a 200 with this body, never a 401 (packages/api-client/src/me.ts).
  await page.route('**/api/v1/me', (route) => route.fulfill({ json: { type: 'anonymous' } }));
}

/** Shorter than playwright.config.ts's 30 s test timeout ON PURPOSE. A wait that
 *  spends the whole test budget fails as a TEST timeout, and Playwright closes
 *  the page before anything can ask what was on it — which is how "waiting for
 *  locator('main')" became the only thing CI could say about 21 failures. */
const PAGE_MAIN_TIMEOUT_MS = 15_000;

/**
 * Wait for the route's own `<main>`, not the route-level loading skeleton.
 *
 * A route-level `loading.tsx` renders its own `<main aria-busy="true">` around
 * a spinner (`apps/web-public/app/e/[eventSlug]/loading.tsx`,
 * `apps/web-admin/app/org/[slug]/loading.tsx`), so `waitForSelector('main')`
 * resolves on the skeleton and Axe scans the spinner instead of the page — a
 * scan that finds nothing and passes. Measured on the event home: a seeded
 * critical violation went undetected in one run out of three until this
 * selector replaced `'main'`, and in none of five afterwards. Use it on every
 * route that has a `loading.tsx` above it; web-staff has none today.
 */
export async function waitForPageMain(page: Page) {
  try {
    return await page.waitForSelector('main:not([aria-busy="true"])', {
      timeout: PAGE_MAIN_TIMEOUT_MS,
    });
  } catch (error) {
    // Say what the page actually IS before giving up. The dev servers print
    // their compile errors to the runner's stdout, which lands in the CI job
    // log — and that log needs admin rights to read, while a failing
    // assertion's message reaches the public check-run annotations. Without
    // this, "waiting for locator('main')" is the whole story from outside.
    throw new Error(`${(error as Error).message}\n\nThe page was ${await describePage(page)}`);
  }
}

/** Never throws: a diagnostic that fails takes the real failure down with it. */
async function describePage(page: Page): Promise<string> {
  try {
    return await page.evaluate(() => {
      const text = (document.body?.innerText ?? '').replace(/\s+/g, ' ').trim();
      // The navigation's own response. An empty page cannot say by itself whether
      // the server sent nothing, sent an error, or sent HTML the browser never
      // rendered — the status, type and size can. They belong to `loadedUrl`, which
      // a client-side redirect leaves behind `url`. `null`, not `undefined`, so a
      // field the browser does not report still shows up in the JSON.
      const [nav] = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
      return JSON.stringify({
        url: location.href,
        loadedUrl: nav?.name ?? null,
        status: nav?.responseStatus ?? null,
        contentType: document.contentType,
        bytes: nav?.decodedBodySize ?? null,
        readyState: document.readyState,
        title: document.title,
        mains: document.querySelectorAll('main').length,
        body: text.slice(0, 400),
      });
    });
  } catch (error) {
    return `unreadable (${(error as Error).message})`;
  }
}

export async function expectNoCriticalAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const critical = results.violations.filter((violation) => violation.impact === 'critical');

  expect(critical, JSON.stringify(critical, null, 2)).toEqual([]);
}

export async function focusUntil(page: Page, target: Locator, maxTabs = 20) {
  for (let i = 0; i < maxTabs; i++) {
    await page.keyboard.press('Tab');
    if (
      await target.evaluate((element) => {
        const active = document.activeElement;
        return active === element || element.contains(active);
      })
    ) {
      await expect(target).toBeFocused();
      return;
    }
  }

  throw new Error(`Could not focus ${await target.evaluate((element) => element.outerHTML)}`);
}
