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
const LOGIN_COOKIE = 'sb-access-token';

/** The part of Next's cookie store this reads — `await cookies()` in a server component. */
interface CookieJar {
  get(name: string): { value: string } | undefined;
}

export function loginCookieHeader(jar: CookieJar): Record<string, string> {
  const value = jar.get(LOGIN_COOKIE)?.value;
  return value ? { cookie: `${LOGIN_COOKIE}=${encodeURIComponent(value)}` } : {};
}
