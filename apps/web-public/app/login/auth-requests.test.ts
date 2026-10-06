import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestPasswordSignIn, requestSignUp } from './auth-requests';

/**
 * What the participant login reads from the API's answer.
 *
 * Lea types the right password while the API is down: the edge answers a 503 with no body.
 * The page said "Wrong email or password", and on the sign-up tab "Signups are temporarily
 * disabled". Each of those two sentences is now said for the API's own answer only.
 */
const API = 'https://api.example.test';

const answers = (status: number, body?: object) =>
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(body ? JSON.stringify(body) : 'Service Unavailable', {
        status,
        headers: body ? { 'Content-Type': 'application/problem+json' } : {},
      }),
    ),
  );

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('requestPasswordSignIn', () => {
  const signIn = () => requestPasswordSignIn(API, 'lea@example.com', 'a-password');

  it('reads a 401 the API wrote as a wrong password', async () => {
    answers(401, { status: 401, code: 'UNAUTHORIZED', detail: 'Invalid email or password' });
    expect(await signIn()).toBe('wrong_password');
  });

  it.each([
    ['a 401 of the edge, with no body', 401, undefined],
    ['a server error of the API', 500, { status: 500, code: 'INTERNAL_SERVER_ERROR' }],
    ['a 503 of the edge', 503, undefined],
    ['a throttled request', 429, { status: 429, code: 'TOO_MANY_REQUESTS' }],
    ['a 403 with another code', 403, { status: 403, code: 'FORBIDDEN' }],
  ])('reads %s as a failed sign-in, not as a wrong password', async (_what, status, body) => {
    answers(status, body);
    expect(await signIn()).toBe('failed');
  });

  it('reads a lost connection as a failed sign-in', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    expect(await signIn()).toBe('failed');
  });

  it('still reads the unconfirmed address and the success', async () => {
    answers(403, { status: 403, code: 'email_not_confirmed' });
    expect(await signIn()).toBe('email_not_confirmed');
    answers(200, { next: '/me' });
    expect(await signIn()).toBe('ok');
  });
});

describe('requestSignUp', () => {
  const signUp = () => requestSignUp(API, 'lea@example.com', 'a-password');

  it('reads "sign-ups are off" from the code of the API\'s 503', async () => {
    answers(503, { status: 503, code: 'signups_disabled' });
    expect(await signUp()).toBe('signups_disabled');
  });

  it.each([
    ['a 503 of the edge, with no body', 503, undefined],
    ['a 503 with another code', 503, { status: 503, code: 'SERVICE_UNAVAILABLE' }],
    ['a server error', 500, { status: 500, code: 'INTERNAL_SERVER_ERROR' }],
  ])('reads %s as a failed sign-up, not as "sign-ups are off"', async (_what, status, body) => {
    answers(status, body);
    expect(await signUp()).toBe('failed');
  });

  it('still reads the stale agreement and the success', async () => {
    answers(400, { status: 400, code: 'legal_version_stale' });
    expect(await signUp()).toBe('legal_stale');
    answers(202, { message: 'sent' });
    expect(await signUp()).toBe('ok');
  });
});

describe('the login page', () => {
  const page = readFileSync(join(__dirname, 'page.tsx'), 'utf8');

  it('says "wrong email or password" for a wrong password only', () => {
    expect(page).toContain(
      [
        "        : code === 'wrong_password'",
        "          ? t('publicApp.login.errors.passwordLoginFailed')",
        "          : t('publicApp.login.errors.signInFailed'),",
      ].join('\n'),
    );
    expect(page.match(/passwordLoginFailed/g)).toHaveLength(1);
  });
});
