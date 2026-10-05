import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ApiFailure } from '@myclash/api-client';
import { describe, expect, it } from 'vitest';
import { oauthFailureKey, passwordLoginFallback } from './sign-in-failure';

/**
 * What the two admin sign-in screens say when the sign-in fails (operator ruling 301).
 *
 * Marc types the right password during a short database fault. The API now answers a server
 * error, and neither screen may turn that into "this account is not allowed": the password form
 * said "Invalid email/password, or this account is not allowed in admin" as its fallback, which
 * fires on a server error only, and the Google callback said "not authorized" for every failure.
 */
const t = (key: string) => `[${key}]`;
const http = (status: number): ApiFailure => ({
  kind: 'http',
  status,
  detail: 'Internal server error',
  code: 'INTERNAL_SERVER_ERROR',
  details: null,
  validationErrors: null,
});
const refused = (status: 401 | 403): ApiFailure => ({
  kind: 'unauthenticated',
  status,
  detail: 'No organizer or super admin access for this account',
  code: 'FORBIDDEN',
  details: null,
});

describe('the Google callback', () => {
  it.each([401, 403] as const)(
    'says "not authorized" for a %s: the API refused the account',
    (s) => {
      expect(oauthFailureKey(refused(s))).toBe('auth.oauth.errors.notAuthorized');
    },
  );

  it('says "not authorized" for the lockdown and for a request the API refused', () => {
    expect(oauthFailureKey(http(503))).toBe('auth.oauth.errors.notAuthorized');
    expect(oauthFailureKey(http(400))).toBe('auth.oauth.errors.notAuthorized');
  });

  it.each([500, 502, 504])('says the sign-in could not be completed for a %s', (status) => {
    expect(oauthFailureKey(http(status))).toBe('auth.oauth.errors.exchangeFailed');
  });

  it('says the sign-in could not be completed when the API was not reached', () => {
    expect(oauthFailureKey({ kind: 'network' })).toBe('auth.oauth.errors.exchangeFailed');
  });

  it('is what the callback screen asks for a refused exchange', () => {
    const screen = readFileSync(join(__dirname, '../components/OAuthCallback.tsx'), 'utf8');
    expect(screen).toContain('throw new OAuthCallbackFailure(oauthFailureKey(r));');
    expect(screen).not.toContain("OAuthCallbackFailure('auth.oauth.errors.notAuthorized')");
  });
});

describe('the password form', () => {
  it('names the lockdown on a 503', () => {
    expect(passwordLoginFallback(http(503), t)).toBe('[admin.featureFlags.lockdownBanner]');
  });

  it.each([http(500), http(400), refused(403), { kind: 'network' } as ApiFailure])(
    'has no sentence of its own for %o: the shared one is said',
    (failure) => {
      expect(passwordLoginFallback(failure, t)).toBeUndefined();
    },
  );

  it('is the fallback the form hands the shared sentence', () => {
    const form = readFileSync(join(__dirname, '../../app/login/AuthPage.tsx'), 'utf8');
    expect(form).toContain('failureMessage(r, t, passwordLoginFallback(r, t))');
    expect(form).not.toContain('passwordLoginFailed');
  });
});
