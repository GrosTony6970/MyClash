/**
 * The pad with a PIN session and a list of pistes, for the stories of the
 * screens before a bout: `pad-last-piste.spec.ts`,
 * `pad-no-network-launch.spec.ts`.
 *
 * The API is stubbed. `network` is what every call meets:
 *   - `up`: the server answers;
 *   - `down`: the answer the pad's service worker gives a dead network, a 503
 *     with `code: 'offline'` (`offlineResponse()`);
 *   - `cut`: the request fails, as with no service worker.
 */
import type { Page } from '@playwright/test';

export const PAD = 'http://localhost:3002';

const piste = (n: number) => ({
  id: `piste-${n}`,
  name: `Piste ${n}`,
  event: { name: 'Spring Open' },
});

export interface PadStub {
  /** The pistes of the sign-in. A story may change them: another person signs in. */
  assigned: number[];
  network: 'up' | 'down' | 'cut';
  /** The PIN account that is signed in. A story may change it: another person signs in. */
  account: string;
  /** The role of that account: where its PIN sign-in lands. */
  role: 'scoring' | 'checkin';
}

export async function stubPad(page: Page, assigned: number[]): Promise<PadStub> {
  const state: PadStub = { assigned, network: 'up', account: 'staff-1', role: 'scoring' };
  // What `staff-auth/me` and the PIN sign-in both answer.
  const me = () => ({ type: 'staff', account: { id: state.account, role: state.role } });
  await page.route('**/api/**', (route) => {
    if (state.network === 'cut') return route.abort();
    if (state.network === 'down') {
      return route.fulfill({
        status: 503,
        json: { error: 'offline', code: 'offline', status: 503 },
      });
    }
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/staff-auth/login')) return route.fulfill({ json: me() });
    if (route.request().method() !== 'GET') return route.fulfill({ json: {} });
    if (path.endsWith('/staff-auth/me')) return route.fulfill({ json: me() });
    if (path.endsWith('/staff/assigned-lices')) {
      return route.fulfill({ json: state.assigned.map(piste) });
    }
    const list = /\/staff\/lices\/(piste-\d)\/matches$/.exec(path);
    if (list) {
      const liceId = list[1] ?? '';
      const liceName = `Piste ${liceId.slice(-1)}`;
      return route.fulfill({ json: { liceId, liceName, matches: [] } });
    }
    return route.fulfill({ status: 404, json: {} });
  });
  return state;
}

export const cards = (page: Page) => page.getByTestId('piste-card');
export const title = (page: Page) => page.getByTestId('lice-title');
export const path = (page: Page) => new URL(page.url()).pathname + new URL(page.url()).search;
/** The app is opened: its first page, as the installed app starts. */
export const openApp = (page: Page) => page.goto(`${PAD}/`);

/** The tablet remembers its Event, as after a sign-in: the banner with the sign-out shows only then. */
export async function rememberEvent(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      'myclash.staff.lastEvent.v1',
      JSON.stringify({ id: 'event-1', slug: 'spring-open', name: 'Spring Open' }),
    );
  });
}

/** The sign-out of the Event banner, from the list of pistes. */
export async function logOut(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^log out$/i }).click();
  await page.getByRole('button', { name: /^log out\?$/i }).click();
  await page.waitForURL(/\/login/);
}
