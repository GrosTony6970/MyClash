/**
 * The viewer's login, for a server read that decides between a page and a 404.
 *
 * This app's server fetches carry no cookie, so a page renders the same for
 * every visitor. A bout of a draft Event or of an unpublished Tournament breaks
 * that: the API answers it exactly like an unknown bout to anyone outside the
 * club, and shows it to a club member (rulings 81-83, 89). A page whose server
 * read 404s would turn the member away before the browser could send their
 * login, so that read sends it.
 *
 * Only the personal login is forwarded. The staff session cookie never reaches
 * this app: it is host-only on the scoring app's host.
 */
import { cookies } from 'next/headers';

const LOGIN_COOKIE = 'sb-access-token';
const REFRESH_COOKIE = 'sb-refresh-token';

/** The part of Next's cookie store this reads — `await cookies()` in a server component. */
interface CookieJar {
  get(name: string): { value: string } | undefined;
}

/**
 * Does this viewer hold a login the browser can renew? A kiosk that starts
 * after its hour-long access token ended still carries the 30-day refresh
 * cookie. Its server read then 404s a hidden bout, but the page must still
 * reach the browser: the keep-alive renews the login through /me, and the
 * scoreboard reads again (rulings 92, 94).
 */
function hasRenewableLogin(jar: CookieJar): boolean {
  return Boolean(jar.get(REFRESH_COOKIE)?.value);
}

/**
 * What a display page does with its server read's status: render the page,
 * answer 404, or fail. A 404 for a viewer with a renewable login still renders
 * the page (see `hasRenewableLogin`); anything else not OK is a failure.
 */
export function displayPageGate(status: number, jar: CookieJar): 'page' | 'not-found' | 'error' {
  if (status >= 200 && status < 300) return 'page';
  if (status === 404) return hasRenewableLogin(jar) ? 'page' : 'not-found';
  return 'error';
}

/** When a login cookie says it ends, in seconds; null when it does not say. It is not verified here. */
function endOf(token: string): number | null {
  try {
    const claims = JSON.parse(
      Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'),
    ) as { exp?: unknown } | null;
    return typeof claims?.exp === 'number' ? claims.exp : null;
  } catch {
    return null;
  }
}

/**
 * Did this viewer's server read go out with a login that ended, which the
 * browser can renew? The login cookie stays in the browser for thirty days and
 * is good for one hour. A club member who opens her draft Event after lunch
 * sends one that ended: the API answers her as it answers a stranger, "not
 * found". The not-found page asks this, renews the login in the browser and
 * loads the page again (`NotFoundCard`).
 *
 * False for a login that is still good: a second read would answer the same.
 */
export function loginNeedsRenewal(jar: CookieJar, nowMs: number): boolean {
  if (!hasRenewableLogin(jar)) return false;
  const token = jar.get(LOGIN_COOKIE)?.value;
  const end = token ? endOf(token) : null;
  return end === null || end * 1000 <= nowMs;
}

/** `loginNeedsRenewal` for the current request; false outside one, as `requestLoginHeader`. */
export async function requestLoginNeedsRenewal(): Promise<boolean> {
  try {
    return loginNeedsRenewal(await cookies(), Date.now());
  } catch {
    return false;
  }
}

export function loginCookieHeader(jar: CookieJar): Record<string, string> {
  const value = jar.get(LOGIN_COOKIE)?.value;
  return value ? { cookie: `${LOGIN_COOKIE}=${encodeURIComponent(value)}` } : {};
}

/**
 * The current request's login header, for a server read deep in a page's helpers. Next throws
 * from `cookies()` outside a request scope; that happens only in the stats perf harness, which
 * renders the page directly and has no viewer, so it reads as signed out: the same reasoning as
 * `@myclash/next-i18n`'s server locale.
 */
export async function requestLoginHeader(): Promise<Record<string, string>> {
  try {
    return loginCookieHeader(await cookies());
  } catch {
    return {};
  }
}
