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
    expect(origins).toContain('https://scoring.myclash.fr');
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
});
