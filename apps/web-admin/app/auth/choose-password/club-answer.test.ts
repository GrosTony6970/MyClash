import { describe, expect, it } from 'vitest';
import type { ApiResult } from '@myclash/api-client';
import { clubAnswer, type ClubBody } from './club-answer';

/**
 * Claire chose her password on the page her organiser sign-up mail opened. The page opens her
 * club only when the password is saved AND she is signed in with it; every coded refusal is
 * said with the sign-up page's own sentence (`signupRefusedKey`).
 */
type Result = ApiResult<ClubBody | undefined>;
const ok = (data: ClubBody | undefined): Result => ({ ok: true, data });
const refused = (status: number, code: string | null): Result =>
  status === 401 || status === 403
    ? { ok: false, kind: 'unauthenticated', status, code, detail: null, details: null }
    : {
        ok: false,
        kind: 'http',
        status,
        code,
        detail: null,
        details: null,
        validationErrors: null,
      };

describe('the answer of the organiser choose-password door', () => {
  it('opens the club when the password is saved and she is signed in', () => {
    expect(clubAnswer(ok({ saved: true, signedIn: true, next: '/org/lyon-amhe' }))).toEqual({
      kind: 'opened',
      next: '/org/lyon-amhe',
    });
  });

  it('asks her to sign in when no login was handed', () => {
    expect(clubAnswer(ok({ saved: true, signedIn: false, next: '/org/lyon-amhe' }))).toEqual({
      kind: 'sign-in',
    });
  });

  it.each([
    [false, 'not-saved'],
    ['unknown', 'unknown'],
  ])('says the password was not saved (%s), and keeps the club to open', (saved, kind) => {
    expect(clubAnswer(ok({ saved, signedIn: true, next: '/org/lyon-amhe' }))).toEqual({
      kind,
      next: '/org/lyon-amhe',
    });
  });

  it.each<[string, Result, string]>([
    ['a link nobody judged', ok({ code: 'link_unchecked' }), 'auth.login.errors.linkUnchecked'],
    ['sign-ups off', refused(503, 'signups_disabled'), 'auth.signup.signupsOff'],
    ['the lockdown', refused(503, 'admin_lockdown'), 'common.apiFailure.adminLockdown'],
  ])('keeps the form open on %s, with the sign-up page’s sentence', (_w, result, key) => {
    expect(clubAnswer(result)).toEqual({ kind: 'refused', key });
  });

  // The code is spent and no club stands: the form would only meet "expired".
  it.each<[string, Result, string]>([
    ['a used link', refused(401, 'link_expired'), 'auth.login.errors.linkExpired'],
    [
      'a club not made (ruling 363)',
      ok({ code: 'club_not_made', saved: true, signedIn: true }),
      'auth.signup.orgNotMade',
    ],
  ])('leaves the form for a second sign-up on %s', (_w, result, key) => {
    expect(clubAnswer(result)).toEqual({ kind: 'restart', key });
  });

  it('reads a weak password and no answer', () => {
    expect(clubAnswer(refused(400, 'weak_password'))).toEqual({ kind: 'weak' });
    expect(clubAnswer({ ok: false, kind: 'network' })).toEqual({ kind: 'network' });
    expect(clubAnswer({ ok: false, kind: 'aborted' })).toEqual({ kind: 'network' });
  });

  it.each<[string, Result]>([
    ["the edge's 401, with no code of ours", refused(401, null)],
    ['a server error', refused(500, 'INTERNAL_SERVER_ERROR')],
    ['a code it does not know', ok({ code: 'something_else' })],
    ['a 200 with no club to open', ok({ saved: true, signedIn: true })],
    ['an empty 200', ok(undefined)],
  ])('fails on %s', (_w, result) => {
    expect(clubAnswer(result)).toEqual({ kind: 'failed' });
  });
});
