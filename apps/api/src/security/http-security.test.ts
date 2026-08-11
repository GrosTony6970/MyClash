import { describe, expect, it } from 'vitest';
import {
  buildClearCookieOptions,
  buildCorsOrigins,
  buildSessionCookieOptions,
} from './http-security';

describe('HTTP security configuration', () => {
  it('builds an explicit CORS allowlist with no wildcard origin', () => {
    const origins = buildCorsOrigins('myclash.fr');

    expect(origins).toContain('https://myclash.fr');
    expect(origins).toContain('https://app.myclash.fr');
    expect(origins).toContain('https://admin.myclash.fr');
    expect(origins).toContain('https://staff.myclash.fr');
    // The marketing site reads /public/site-stats from the browser. Prod serves
    // it from the apex, dev from its own subdomain.
    expect(origins).toContain('https://marketing.myclash.fr');
    expect(origins).not.toContain('*');
  });

  it('uses secure httpOnly sameSite=lax session cookies in production', () => {
    expect(buildSessionCookieOptions({ env: 'production', maxAge: 3600 })).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 3600,
    });
  });

  it('keeps development cookies local while preserving httpOnly and SameSite', () => {
    expect(buildSessionCookieOptions({ env: 'development' })).toMatchObject({
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      path: '/',
    });
  });

  it('clears cookies with matching path, SameSite, and production secure posture', () => {
    expect(buildClearCookieOptions('production')).toEqual({
      secure: true,
      sameSite: 'lax',
      path: '/',
    });
  });

  it('scopes session cookies to the parent domain when provided', () => {
    expect(
      buildSessionCookieOptions({ env: 'production', maxAge: 3600, domain: '.myclash.fr' }),
    ).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      domain: '.myclash.fr',
    });
  });

  it('omits the domain attribute when none is provided (host-only cookie)', () => {
    expect(buildSessionCookieOptions({ env: 'production' })).not.toHaveProperty('domain');
  });

  it('clears cookies with the matching parent domain so logout actually removes them', () => {
    expect(buildClearCookieOptions('production', '.myclash.fr')).toEqual({
      secure: true,
      sameSite: 'lax',
      path: '/',
      domain: '.myclash.fr',
    });
  });
});
