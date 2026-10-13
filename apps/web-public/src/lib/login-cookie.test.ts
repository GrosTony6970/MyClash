import { describe, expect, it } from 'vitest';
import {
  displayPageGate,
  loginCookieHeader,
  loginNeedsRenewal,
  requestLoginHeader,
  requestLoginNeedsRenewal,
} from './login-cookie';

const jar = (cookies: Record<string, string>) => ({
  get: (name: string) => (name in cookies ? { value: cookies[name] as string } : undefined),
});

describe('loginCookieHeader', () => {
  it('forwards the personal login, and nothing else', () => {
    expect(
      loginCookieHeader(jar({ 'sb-access-token': 'a.b.c', mc_guest: 'g', theme: 'dark' })),
    ).toEqual({ cookie: 'sb-access-token=a.b.c' });
  });

  it('sends no cookie header for a visitor with no login', () => {
    expect(loginCookieHeader(jar({ theme: 'dark' }))).toEqual({});
  });

  it('encodes the value so it cannot end the header early', () => {
    expect(loginCookieHeader(jar({ 'sb-access-token': 'x; theme=light' }))).toEqual({
      cookie: 'sb-access-token=x%3B%20theme%3Dlight',
    });
  });
});

// A kiosk that starts after its hour-long token ended still holds the 30-day
// refresh cookie: the page must reach the browser, whose keep-alive renews the
// login and whose scoreboard then reads again (rulings 92, 94).
describe('displayPageGate', () => {
  const renewable = jar({ 'sb-refresh-token': 'r', 'sb-access-token': 'old' });
  const signedOut = jar({ theme: 'dark' });

  it('renders the page for a bout the server read found', () => {
    expect(displayPageGate(200, signedOut)).toBe('page');
  });

  it('renders the page for a 404 when the viewer holds a login the browser can renew', () => {
    expect(displayPageGate(404, renewable)).toBe('page');
    expect(displayPageGate(404, jar({ 'sb-refresh-token': 'r' }))).toBe('page');
  });

  it('answers 404 to a viewer with no renewable login', () => {
    expect(displayPageGate(404, signedOut)).toBe('not-found');
    expect(displayPageGate(404, jar({ 'sb-access-token': 'a' }))).toBe('not-found');
    expect(displayPageGate(404, jar({ 'sb-refresh-token': '' }))).toBe('not-found');
  });

  it('fails on any other refusal, renewable login or not', () => {
    for (const status of [401, 500, 503]) {
      expect(displayPageGate(status, renewable)).toBe('error');
      expect(displayPageGate(status, signedOut)).toBe('error');
    }
  });
});

/**
 * A club member opens her draft Event an hour after her last visit. The server
 * read carries a login that ended, so the API answers "not found". The
 * not-found page then asks the browser to renew the login and to load the page
 * again. It asks only when that can change the answer.
 */
describe('loginNeedsRenewal', () => {
  const NOW = 1_800_000_000_000;
  const token = (claims: object) =>
    `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
  const endingAt = (ms: number) => token({ exp: ms / 1000 });

  it('a login that ended, with the cookie that renews it', () => {
    const lapsed = { 'sb-refresh-token': 'r', 'sb-access-token': endingAt(NOW - 1_000) };
    expect(loginNeedsRenewal(jar(lapsed), NOW)).toBe(true);
    expect(loginNeedsRenewal(jar({ ...lapsed, 'sb-access-token': endingAt(NOW) }), NOW)).toBe(true);
  });

  it('no login cookie at all, with the cookie that renews it', () => {
    expect(loginNeedsRenewal(jar({ 'sb-refresh-token': 'r' }), NOW)).toBe(true);
  });

  it('a login cookie nobody can read is asked for again', () => {
    for (const value of ['a-login', 'a.b.c', token({}), token({ exp: 'soon' })]) {
      const held = jar({ 'sb-refresh-token': 'r', 'sb-access-token': value });
      expect(loginNeedsRenewal(held, NOW)).toBe(true);
    }
  });

  it('not a login that is still good: the answer would be the same', () => {
    const good = jar({ 'sb-refresh-token': 'r', 'sb-access-token': endingAt(NOW + 1_000) });
    expect(loginNeedsRenewal(good, NOW)).toBe(false);
  });

  it('not a visitor with nothing to renew it with', () => {
    expect(loginNeedsRenewal(jar({ theme: 'dark' }), NOW)).toBe(false);
    expect(loginNeedsRenewal(jar({ 'sb-access-token': endingAt(NOW - 1_000) }), NOW)).toBe(false);
    expect(loginNeedsRenewal(jar({ 'sb-refresh-token': '' }), NOW)).toBe(false);
  });

  it('reads as "no" outside a request scope, where Next throws from cookies()', async () => {
    await expect(requestLoginNeedsRenewal()).resolves.toBe(false);
  });
});

describe('requestLoginHeader', () => {
  it('reads as signed out outside a request scope, where Next throws from cookies()', async () => {
    await expect(requestLoginHeader()).resolves.toEqual({});
  });
});
