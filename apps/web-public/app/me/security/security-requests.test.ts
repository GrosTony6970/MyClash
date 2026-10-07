import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  accountDeletionRefusalKey,
  passwordChangeRefusalKey,
  requestAccountDeletion,
  requestPasswordChange,
  type SecurityRefusal,
} from './security-requests';

/**
 * What the security page reads from the two doors that ask the current password again
 * (operator ruling 329).
 *
 * Marie leaves the page open and her login runs out. She types the RIGHT current password and
 * the page said "Current password is incorrect": it read every 401 as a wrong password. A
 * wrong password is the API's coded 403 now; a 401 is an ended session, which the page first
 * tries to renew, once.
 */
const API = 'https://api.example.test';

const response = (status: number, body?: object) =>
  new Response(body ? JSON.stringify(body) : 'refused', {
    status,
    headers: body ? { 'Content-Type': 'application/problem+json' } : {},
  });

/** The API's answers, one per call, in order. Hands back the stub to count the calls. */
function answers(...queue: Response[]) {
  const fetched = vi.fn();
  for (const next of queue) fetched.mockResolvedValueOnce(next);
  vi.stubGlobal('fetch', fetched);
  return fetched;
}

const wrongPassword = () =>
  response(403, {
    status: 403,
    code: 'wrong_current_password',
    detail: 'Current password is incorrect',
  });
const noSession = () => response(401, { status: 401, code: 'UNAUTHORIZED', detail: 'No session' });
const me = (type: 'claimed' | 'anonymous') => response(200, { type });

afterEach(() => {
  vi.unstubAllGlobals();
});

const DOORS = {
  'the password change': () => requestPasswordChange(API, 'current', 'A-much-Longer-passw0rd!'),
  'the account deletion': () => requestAccountDeletion(API, 'current', 'DELETE'),
};

describe.each(Object.entries(DOORS))('%s', (_door, ask) => {
  // The renewal runs in a browser only: `fetchRenewingLogin` reads `window`.
  const inBrowser = () => vi.stubGlobal('window', globalThis);

  it('reads the coded 403 as a wrong password, and asks once', async () => {
    inBrowser();
    const fetched = answers(wrongPassword());

    expect(await ask()).toBe('wrong_password');
    expect(fetched).toHaveBeenCalledTimes(1);
  });

  it('renews an ended login once and sends the request again', async () => {
    inBrowser();
    const fetched = answers(noSession(), me('claimed'), response(200, { ok: true }));

    expect(await ask()).toBe('ok');
    expect(fetched.mock.calls.map(([url]) => String(url).replace(API, ''))).toEqual([
      expect.stringMatching(/^\/api\/v1\/me\/(change-password|account)$/),
      '/api/v1/me',
      expect.stringMatching(/^\/api\/v1\/me\/(change-password|account)$/),
    ]);
  });

  it('reads a login that cannot be renewed as an ended session, not as a wrong password', async () => {
    inBrowser();
    answers(noSession(), me('anonymous'));

    expect(await ask()).toBe('session_ended');
  });

  it.each([
    ['a 401 of the edge, with no body', response(401)],
    ['a 403 with another code', response(403, { status: 403, code: 'FORBIDDEN' })],
    ['a server error', response(500, { status: 500, code: 'INTERNAL_SERVER_ERROR' })],
    ['a 503 of the edge', response(503)],
  ])('reads %s as a failed request', async (_what, answer) => {
    answers(answer);

    expect(await ask()).toBe('failed');
  });

  it('reads a lost connection as its own answer', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    expect(await ask()).toBe('network');
  });

  it('sends the login and the typed values', async () => {
    const fetched = answers(response(200, { ok: true }));

    expect(await ask()).toBe('ok');
    const [, init] = fetched.mock.calls[0] as [string, RequestInit];
    expect(init.credentials).toBe('include');
    expect(JSON.parse(String(init.body))).toMatchObject({ currentPassword: 'current' });
  });
});

describe('the request each door sends', () => {
  it.each([
    [
      'the password change',
      'POST',
      '/api/v1/me/change-password',
      { newPassword: 'A-much-Longer-passw0rd!' },
    ],
    ['the account deletion', 'DELETE', '/api/v1/me/account', { confirmation: 'DELETE' }],
  ] as [keyof typeof DOORS, string, string, object][])(
    '%s is a %s to %s',
    async (door, method, path, typed) => {
      const fetched = answers(response(200, { ok: true }));

      await DOORS[door]();

      const [url, init] = fetched.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${API}${path}`);
      expect(init.method).toBe(method);
      expect(JSON.parse(String(init.body))).toEqual({ currentPassword: 'current', ...typed });
    },
  );
});

describe('the account deletion, refused for what was typed', () => {
  const ask = DOORS['the account deletion'];

  it('reads the Google-only refusal by its code', async () => {
    answers(response(400, { status: 400, code: 'no_password_set' }));
    expect(await ask()).toBe('no_password_set');
  });

  it('reads another 400 as a refused request', async () => {
    answers(response(400, { status: 400, code: 'confirmation_mismatch' }));
    expect(await ask()).toBe('bad_request');
  });
});

describe('the sentence of a refused request', () => {
  const errors = 'publicApp.security.errors';

  it.each<[SecurityRefusal, string]>([
    ['wrong_password', `${errors}.wrongCurrentPassword`],
    ['network', `${errors}.network`],
    ['failed', `${errors}.changePasswordFailed`],
    ['bad_request', `${errors}.changePasswordFailed`],
    ['no_password_set', `${errors}.changePasswordFailed`],
  ])('of a password change: %s', (refusal, key) => {
    expect(passwordChangeRefusalKey(refusal)).toBe(key);
  });

  it.each<[SecurityRefusal, string]>([
    ['wrong_password', `${errors}.wrongCurrentPassword`],
    ['no_password_set', `${errors}.noPasswordSet`],
    ['bad_request', `${errors}.confirmationMismatch`],
    ['network', `${errors}.network`],
    ['failed', `${errors}.deleteFailed`],
  ])('of an account deletion: %s', (refusal, key) => {
    expect(accountDeletionRefusalKey(refusal)).toBe(key);
  });
});

describe('the security page', () => {
  const page = readFileSync(join(__dirname, 'page.tsx'), 'utf8');

  it('asks both doors through the request module, with no fetch of its own for them', () => {
    expect(page).toContain('await requestPasswordChange(apiUrl, currentPassword, newPassword)');
    expect(page).toContain('await requestAccountDeletion(apiUrl, currentPassword, confirmation)');
    expect(page).toContain('setError(t(passwordChangeRefusalKey(answer)));');
    expect(page).toContain('setError(t(accountDeletionRefusalKey(answer)));');
    expect(page).not.toContain('/api/v1/me/change-password');
    expect(page).not.toContain('/api/v1/me/account');
  });

  it('says the ended session in both sections, with the way back to the sign-in page', () => {
    expect(
      page.match(/if \(answer === 'session_ended'\) setSessionEnded\(true\);\s+else setError/g),
    ).toHaveLength(2);
    expect(page.match(/^\s+setSessionEnded\(false\);$/gm)).toHaveLength(4);
    expect(page.match(/\{sessionEnded && <SessionEnded t=\{t\} \/>\}/g)).toHaveLength(2);
    const notice = readFileSync(join(__dirname, 'SessionEnded.tsx'), 'utf8');
    expect(notice).toContain("t('publicApp.security.errors.sessionEnded')");
    expect(notice).toContain('<Link href="/login"');
  });
});
