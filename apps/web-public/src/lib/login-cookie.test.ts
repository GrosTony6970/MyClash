import { describe, expect, it } from 'vitest';
import { displayPageGate, loginCookieHeader, requestLoginHeader } from './login-cookie';

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

describe('requestLoginHeader', () => {
  it('reads as signed out outside a request scope, where Next throws from cookies()', async () => {
    await expect(requestLoginHeader()).resolves.toEqual({});
  });
});
