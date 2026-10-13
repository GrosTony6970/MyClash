/**
 * The pad's sign-in screen with nobody signed in, for `pad-sign-in.spec.ts`.
 *
 * The API is stubbed. A story sets what the next sign-in meets:
 *   - `answer`: the status and the body of the PIN route and of the link route
 *     (a body with a `code` is the API's problem+json; `{}` is the edge's);
 *   - `network`: `down` is the answer the pad's service worker gives a dead
 *     network, `cut` a request that fails, as with no service worker.
 */
import { expect, type Page, type Request } from '@playwright/test';

export const PAD = 'http://localhost:3002';

const EVENTS = [
  {
    id: 'event-1',
    slug: 'spring-open',
    name: 'Spring Open',
    startDate: '2026-08-08',
    status: 'running',
    kind: 'standard',
  },
  {
    id: 'event-2',
    slug: 'club-night',
    name: 'Club Night',
    startDate: '2026-08-15',
    status: 'running',
    kind: 'standard',
  },
];

export interface SignInStub {
  answer: { status: number; json: Record<string, unknown> };
  network: 'up' | 'down' | 'cut';
  /** The list of Events the picker gets. A story may empty it. */
  events: typeof EVENTS;
  /** Every request to the PIN route or to the link route, in order. */
  sent: Request[];
}

/** The API's own refusal: problem+json, with a code and a detail. */
export const problem = (status: number, code: string, detail: string) => ({
  status,
  json: { status, code, detail, message: detail },
});

export async function stubSignIn(page: Page): Promise<SignInStub> {
  const state: SignInStub = {
    answer: { status: 200, json: { type: 'staff', account: { id: 'staff-1', role: 'scoring' } } },
    network: 'up',
    events: EVENTS,
    sent: [],
  };
  await page.route('**/api/**', (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const door = path.endsWith('/staff-auth/login') || path.endsWith('/auth/magic-link');
    if (door) state.sent.push(request);
    if (state.network === 'cut') return route.abort();
    if (state.network === 'down') {
      return route.fulfill({
        status: 503,
        json: { error: 'offline', code: 'offline', status: 503 },
      });
    }
    if (path.endsWith('/staff-auth/events')) return route.fulfill({ json: state.events });
    if (door) return route.fulfill(state.answer);
    return route.fulfill({ status: 404, json: {} });
  });
  return state;
}

/** The sign-in screen, as a volunteer with no link gets it: the list of Events. */
export const openSignIn = (page: Page) => page.goto(`${PAD}/login`);
/**
 * The sign-in screen behind the organiser's printed link: the Event is named.
 *
 * Such a page puts the cursor in the PIN field once it has loaded. A story
 * that types before that sees its text land in the PIN field: the wait is for
 * that cursor.
 */
export async function openLinked(page: Page): Promise<void> {
  await page.goto(`${PAD}/login?event=spring-open&u=marie`);
  await expect(page.locator('#staffPin')).toBeFocused();
}

export const pinForm = (page: Page) => page.locator('form:has(#staffPin)');
export const emailForm = (page: Page) => page.locator('form:has(#email)');

/** Type the PIN and press the form's button. */
export async function signIn(page: Page, pin = '1234'): Promise<void> {
  await page.locator('#staffPin').fill(pin);
  await pinForm(page).locator('button[type="submit"]').click();
}
