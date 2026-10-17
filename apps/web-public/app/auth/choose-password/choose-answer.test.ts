import { describe, expect, it } from 'vitest';
import type { ApiResult } from '@myclash/api-client';
import { chooseAnswer, type ChooseBody } from './choose-answer';

/**
 * Léa chose her password on the page her sign-up mail opened. The page acts on the door's
 * answer: it opens her page only when the password is saved AND she is signed in with it.
 */
const ok = (data: ChooseBody | undefined): ApiResult<ChooseBody | undefined> => ({
  ok: true,
  data,
});
const refused = (status: number, code: string | null): ApiResult<ChooseBody | undefined> =>
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

describe('the answer of the "choose your password" door', () => {
  it('opens the page she began on when the password is saved and she is signed in', () => {
    expect(chooseAnswer(ok({ saved: true, signedIn: true, next: '/e/fal-2026' }))).toEqual({
      kind: 'signed-in',
      next: '/e/fal-2026',
    });
  });

  it('asks her to sign in when the password is saved but no login was handed', () => {
    expect(chooseAnswer(ok({ saved: true, signedIn: false, next: '/me' }))).toEqual({
      kind: 'sign-in',
    });
  });

  it.each([
    [false, 'not-saved'],
    ['unknown', 'unknown'],
  ])('says the password was not saved (%s) whatever signedIn says', (saved, kind) => {
    expect(chooseAnswer(ok({ saved, signedIn: true, next: '/me' }))).toEqual({ kind });
  });

  it('reads the refusals by their code', () => {
    expect(chooseAnswer(refused(401, 'link_expired'))).toEqual({ kind: 'expired' });
    expect(chooseAnswer(ok({ code: 'link_unchecked' }))).toEqual({ kind: 'unchecked' });
    expect(chooseAnswer(refused(400, 'weak_password'))).toEqual({ kind: 'weak' });
  });

  it.each<[string, ApiResult<ChooseBody | undefined>]>([
    ['no answer', { ok: false, kind: 'network' }],
    ['no answer in time', { ok: false, kind: 'aborted' }],
  ])('says the server could not be reached on %s', (_what, result) => {
    expect(chooseAnswer(result)).toEqual({ kind: 'network' });
  });

  it.each<[string, ApiResult<ChooseBody | undefined>]>([
    ["the edge's 401, with no code of ours", refused(401, null)],
    ['another 400', refused(400, 'validation_failed')],
    ['a 503', refused(503, null)],
    ['a server error', refused(500, 'INTERNAL_SERVER_ERROR')],
    ['an empty 200', ok(undefined)],
    ['a 200 that says nothing it knows', ok({ saved: 'yes' })],
  ])('fails on %s', (_what, result) => {
    expect(chooseAnswer(result)).toEqual({ kind: 'failed' });
  });

  it('falls back to the home page when the door names none', () => {
    expect(chooseAnswer(ok({ saved: true, signedIn: true }))).toEqual({
      kind: 'signed-in',
      next: '/',
    });
  });
});
