import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ApiFailure } from '@myclash/api-client';
import { createTranslator, getMessages } from '@myclash/i18n';
import { describe, expect, it } from 'vitest';
import {
  oauthFailureKey,
  ownedClubNoticeKey,
  passwordLoginMessage,
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
 *
 * The maintenance lockdown (operator ruling 308): its 503 had no code and its words were
 * replaced, so the password form said "Internal server error" for it, said the lockdown for a
 * 503 of the edge, and the Google callback said "not authorized" for both.
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
/** The API's answer at a sign-in door while the maintenance lockdown is on. */
const lockdown = http(503, {
  code: 'admin_lockdown',
  detail: 'MyClash is in maintenance. Try again later.',
});
/** The API's answer at a sign-up door while read-only mode is on (operator ruling 341). */
const readOnly = http(503, {
  code: 'read_only_mode',
  detail: 'MyClash is in maintenance. Nothing can be saved for now. Try again later.',
});

// Operator ruling 328: the sign-in screens said "Only super admins can sign in", which is
// untrue for platform staff of another tier. One sentence for the lockdown, on every screen.
it('keeps no sentence of its own for the lockdown', () => {
  const source = readFileSync(join(__dirname, 'sign-in-failure.ts'), 'utf8');
  expect(source).not.toContain('lockdownBanner');
  for (const locale of ['en', 'fr']) {
    const messages = readFileSync(
      join(__dirname, `../../../../packages/i18n/src/messages/${locale}/admin.ts`),
      'utf8',
    );
    expect(messages).not.toContain('lockdownBanner');
    expect(messages).not.toMatch(/super admins can sign in|super-administrateurs peuvent/);
  }
});
/** A 503 the API did not write: the edge answered for it, with no body to read. */
const edge503: ApiFailure = {
  kind: 'http',
  status: 503,
  detail: null,
  code: null,
  details: null,
  validationErrors: null,
};
const refused = (status: 401 | 403, detail: string): ApiFailure => ({
  kind: 'unauthenticated',
  status,
  detail,
  code: status === 401 ? 'UNAUTHORIZED' : 'FORBIDDEN',
  details: null,
});
const noAccess = 'No organizer or super admin access for this account';
const wrongPassword = refused(401, 'Invalid email or password');

describe('the Google callback', () => {
  it.each<401 | 403>([401, 403])(
    'says "not authorized" for a %s: the API refused the account',
    (s) => {
      expect(oauthFailureKey(refused(s, noAccess))).toBe('auth.oauth.errors.notAuthorized');
    },
  );

  it('says "not authorized" for a request the API refused', () => {
    expect(oauthFailureKey(http(400))).toBe('auth.oauth.errors.notAuthorized');
  });

  it('says the lockdown for the coded 503 of the lockdown', () => {
    expect(oauthFailureKey(lockdown)).toBe('common.apiFailure.adminLockdown');
  });

  it.each([500, 502, 503, 504])('says the sign-in could not be completed for a %s', (status) => {
    expect(oauthFailureKey(http(status))).toBe('auth.oauth.errors.exchangeFailed');
  });

  it('says the sign-in could not be completed for a 503 of the edge', () => {
    expect(oauthFailureKey(edge503)).toBe('auth.oauth.errors.exchangeFailed');
  });

  it('says the sign-in could not be completed when the API was not reached', () => {
    expect(oauthFailureKey({ kind: 'network' })).toBe('auth.oauth.errors.exchangeFailed');
  });

  // Ruling 305: the Google sign-up said "this Google account is not authorized".
  it('says sign-ups are off for the coded 503 of the switch', () => {
    expect(oauthFailureKey(signupsOff)).toBe('auth.signup.signupsOff');
  });

  // Ruling 341: the Google sign-up said "the sign-in could not be completed".
  it('says the maintenance for the coded 503 of read-only mode', () => {
    expect(oauthFailureKey(readOnly)).toBe('common.apiFailure.readOnlyMode');
  });

  it('is what the callback screen asks for a refused exchange', () => {
    const screen = readFileSync(join(__dirname, '../components/OAuthCallback.tsx'), 'utf8');
    expect(screen).toContain('throw new OAuthCallbackFailure(oauthFailureKey(r));');
    expect(screen).not.toContain("OAuthCallbackFailure('auth.oauth.errors.notAuthorized')");
  });
});

describe('the password form', () => {
  it('says the lockdown for the coded 503 of the lockdown, in its own language', () => {
    expect(passwordLoginMessage(lockdown, t)).toBe('[common.apiFailure.adminLockdown]');
  });

  it('does not say the lockdown for a 503 of the edge: the shared sentence is said', () => {
    expect(passwordLoginMessage(edge503, t)).toBe('[common.error]');
  });

  // Ruling 309: she read "Your session has expired, or this is not yours to see".
  it('says "wrong email or password" for the 401 the API answers', () => {
    expect(passwordLoginMessage(wrongPassword, t)).toBe('[auth.login.errors.wrongPassword]');
  });

  it('says "the connection was blocked" for a 401 the API did not write', () => {
    const edge401: ApiFailure = {
      kind: 'unauthenticated',
      status: 401,
      detail: null,
      code: null,
      details: null,
    };
    expect(passwordLoginMessage(edge401, t)).toBe('[common.apiFailure.blocked]');
  });

  it("says the server's own sentence for an account with no admin access", () => {
    expect(passwordLoginMessage(refused(403, noAccess), t)).toBe(noAccess);
  });

  it.each<[ApiFailure, string]>([
    [http(500), '[common.error]'],
    [http(429), '[common.apiFailure.tooManyRequests]'],
    [{ kind: 'network' }, '[common.apiFailure.network]'],
  ])('says the shared sentence for %o', (failure, sentence) => {
    expect(passwordLoginMessage(failure, t)).toBe(sentence);
  });

  it('is what the form says for a refused sign-in', () => {
    const form = readFileSync(join(__dirname, '../../app/login/AuthPage.tsx'), 'utf8');
    expect(form).toContain('const message = passwordLoginMessage(r, t);');
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

  // Ruling 341: the shared sentence, which says read-only mode by its code.
  it('says the maintenance for the coded 503 of read-only mode', () => {
    expect(signupFailureMessage(readOnly, t)).toBe('[common.apiFailure.readOnlyMode]');
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

  // Operator ruling 324: both mailed links' doors write the lockdown.
  it('says the lockdown for the reason the door writes', () => {
    expect(signupRefusedKey('admin_lockdown')).toBe('common.apiFailure.adminLockdown');
  });

  // Operator ruling 341: the sign-up link's door writes read-only mode.
  it('says the maintenance for the reason the door writes', () => {
    expect(signupRefusedKey('read_only_mode')).toBe('common.apiFailure.readOnlyMode');
  });

  // Rulings 360 and 362: a link the auth server refused, and one it did not judge.
  it.each([
    ['link_expired', 'auth.login.errors.linkExpired'],
    ['link_unchecked', 'auth.login.errors.linkUnchecked'],
  ])('says a link that signed nobody in for %s', (reason, key) => {
    expect(signupRefusedKey(reason)).toBe(key);
  });

  // Ruling 363: the link was spent and the organization was not written.
  it('says to fill the form again for an organization that was not made', () => {
    expect(signupRefusedKey('club_not_made')).toBe('auth.signup.orgNotMade');
  });

  it.each([undefined, '', 'something-else', 'already_owns_club'])(
    'says nothing for %o',
    (value) => {
      expect(signupRefusedKey(value)).toBeNull();
    },
  );

  it('is read by the sign-in page too, for a mailed sign-in link', () => {
    const page = readFileSync(join(__dirname, '../../app/login/page.tsx'), 'utf8');
    expect(page).toContain('initialTab="signin"');
    expect(page).toContain(
      'refused={signupRefusedKey((await searchParams)[SIGNUP_REFUSED_PARAM])}',
    );
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

/**
 * No second club at the sign-up (operator ruling 369).
 *
 * Paul owns a club and signs up again with the same address. The door makes no second club:
 * it signs him in and sends him into the club he owns. That page says why he is there.
 */
describe('the club page after a sign-up that made no second club (ruling 369)', () => {
  it('says he has one already, for the reason the door writes', () => {
    expect(ownedClubNoticeKey('?refused=already_owns_club')).toBe('auth.signup.alreadyOwnsOrg');
  });

  it.each(['en', 'fr'] as const)('has its sentence in %s', (locale) => {
    const key = ownedClubNoticeKey('?refused=already_owns_club')!;
    expect(createTranslator(getMessages(locale))(key)).not.toBe(`[${key}]`);
  });

  it.each([
    '',
    '?refused=',
    '?refused=club_not_made',
    '?refused=link_expired',
    '?other=already_owns_club',
  ])('says nothing for %j', (search) => {
    expect(ownedClubNoticeKey(search)).toBeNull();
  });

  it('is read by the club page from its address', () => {
    const read = (path: string) => readFileSync(join(__dirname, '../..', path), 'utf8');
    const notice = read('app/org/[slug]/_components/OwnedClubNotice.tsx');
    expect(notice).toContain('const key = ownedClubNoticeKey(search);');
    expect(notice).toContain('{t(key)}');
    expect(read('app/org/[slug]/page.tsx')).toContain('<OwnedClubNotice />');
  });
});
