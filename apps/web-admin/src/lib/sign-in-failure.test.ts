import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ApiFailure } from '@myclash/api-client';
import { describe, expect, it } from 'vitest';
import {
  oauthFailureKey,
  passwordLoginFallback,
  signupFailureMessage,
  signupRefusedKey,
} from './sign-in-failure';

/**
 * What the two admin sign-in screens say when the sign-in fails (operator ruling 301).
 *
 * Marc types the right password during a short database fault. The API now answers a server
 * error, and neither screen may turn that into "this account is not allowed": the password form
 * said "Invalid email/password, or this account is not allowed in admin" as its fallback, which
 * fires on a server error only, and the Google callback said "not authorized" for every failure.
 */
const t = (key: string) => `[${key}]`;
const http = (status: number, over: { code?: string; detail?: string } = {}): ApiFailure => ({
  kind: 'http',
  status,
  detail: 'Internal server error',
  code: 'INTERNAL_SERVER_ERROR',
  details: null,
  validationErrors: null,
  ...over,
});
/** The API's answer at a sign-up door while a super admin has switched sign-ups off. */
const signupsOff = http(503, { code: 'signups_disabled' });
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

  // Ruling 305: the Google sign-up said "this Google account is not authorized".
  it('says sign-ups are off for the coded 503 of the switch', () => {
    expect(oauthFailureKey(signupsOff)).toBe('auth.signup.signupsOff');
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

/**
 * "Sign-ups off" on the sign-up form and on the sign-up page (operator ruling 305).
 *
 * The form said "Signup failed" for the switch's 503. And the mailed link's door now sends its
 * reader to the sign-up page with the reason in the address, because a browser that follows a
 * link cannot read a 503.
 */
describe('the sign-up form', () => {
  it('says sign-ups are off for the coded 503 of the switch', () => {
    expect(signupFailureMessage(signupsOff, t)).toBe('[auth.signup.signupsOff]');
  });

  it('says the policy moved on for a stale agreement', () => {
    const stale = http(400, { code: 'legal_version_stale' });
    expect(signupFailureMessage(stale, t)).toBe('[legal.accept.stale]');
  });

  it('says "sign-up failed" for a server error', () => {
    expect(signupFailureMessage(http(500), t)).toBe('[admin.common.signupFailed]');
  });

  it("says the server's own sentence for a refusal that carries one", () => {
    const taken = http(409, { detail: 'The slug "lyon" is already taken' });
    expect(signupFailureMessage(taken, t)).toBe('The slug "lyon" is already taken');
  });

  it('is what the form says for a refused sign-up', () => {
    const form = readFileSync(join(__dirname, '../../app/login/AuthPage.tsx'), 'utf8');
    expect(form).toContain('const message = signupFailureMessage(r, t);');
    expect(form).not.toContain("t('admin.common.signupFailed')");
  });
});

describe('the sign-up page after a refused mail link', () => {
  it('says sign-ups are off for the reason the door writes', () => {
    expect(signupRefusedKey('signups_disabled')).toBe('auth.signup.signupsOff');
  });

  it.each([undefined, '', 'something-else'])('says nothing for %o', (value) => {
    expect(signupRefusedKey(value)).toBeNull();
  });

  it('is read by the page from its address and said by the form when it opens', () => {
    const page = readFileSync(join(__dirname, '../../app/signup/page.tsx'), 'utf8');
    expect(page).toContain(
      'refused={signupRefusedKey((await searchParams)[SIGNUP_REFUSED_PARAM])}',
    );
    const form = readFileSync(join(__dirname, '../../app/login/AuthPage.tsx'), 'utf8');
    expect(form).toContain('useState<string | null>(refused ? t(refused) : null)');
  });
});
