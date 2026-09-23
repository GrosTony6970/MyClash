import { describe, expect, it } from 'vitest';
import { loginCookieHeader } from './login-cookie';

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
