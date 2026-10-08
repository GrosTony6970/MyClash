import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  accountDeletionRefusalKey,
  passwordChangeRefusalKey,
  passwordSetLinkRefusalKey,
  readSecurityStatus,
  requestAccountDeletion,
  requestPasswordChange,
  requestPasswordSetLink,
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
    const fetched = answers(
      noSession(),
      me('claimed'),
      response(200, { ok: true, signedIn: true }),
    );

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
    const fetched = answers(response(200, { ok: true, signedIn: true }));

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
      const fetched = answers(response(200, { ok: true, signedIn: true }));

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

  // The API has one 400 here. It refused a Google-only account with `no_password_set` once;
  // it deletes that account on the typed word alone now, and the page's branch could not fire.
  it('reads a 400 as a refused request', async () => {
    answers(response(400, { status: 400, code: 'confirmation_mismatch' }));
    expect(await ask()).toBe('bad_request');
  });
});

/**
 * The page's first read. It was a `fetch` of the page's own: a login that ran out while the
 * tab was closed sent her to the sign-in page, though her refresh cookie could renew it.
 */
describe('the first read of the security page', () => {
  const STATUS = { hasPassword: true, email: 'marie@example.com' };
  const ask = () => readSecurityStatus(API, new AbortController().signal);

  it('renews an ended login once and reads again', async () => {
    vi.stubGlobal('window', globalThis);
    const fetched = answers(noSession(), me('claimed'), response(200, STATUS));

    expect(await ask()).toEqual(STATUS);
    expect(fetched.mock.calls.map(([url]) => String(url).replace(API, ''))).toEqual([
      '/api/v1/me/security-status',
      '/api/v1/me',
      '/api/v1/me/security-status',
    ]);
  });

  it('reads a login that cannot be renewed as an ended session', async () => {
    vi.stubGlobal('window', globalThis);
    answers(noSession(), me('anonymous'));

    expect(await ask()).toBe('session_ended');
  });

  it.each([
    ['a 401 of the edge, with no body', response(401)],
    ['a 403', response(403, { status: 403, code: 'FORBIDDEN' })],
    ['a server error', response(500, { status: 500, code: 'INTERNAL_SERVER_ERROR' })],
  ])('reads %s as a failed read', async (_what, answer) => {
    answers(answer);

    expect(await ask()).toBe('failed');
  });

  it('reads a lost connection as a failed read', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    expect(await ask()).toBe('failed');
  });

  it('says nothing of a read the page itself stopped', async () => {
    const stopped = new DOMException('stopped', 'AbortError');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(stopped));

    expect(await ask()).toBe('aborted');
  });
});

describe('the sentence of a refused request', () => {
  const errors = 'publicApp.security.errors';

  it.each<[SecurityRefusal, string]>([
    ['wrong_password', `${errors}.wrongCurrentPassword`],
    ['network', `${errors}.network`],
    ['failed', `${errors}.changePasswordFailed`],
    ['bad_request', `${errors}.changePasswordFailed`],
  ])('of a password change: %s', (refusal, key) => {
    expect(passwordChangeRefusalKey(refusal)).toBe(key);
  });

  it.each<[SecurityRefusal, string]>([
    ['wrong_password', `${errors}.wrongCurrentPassword`],
    ['bad_request', `${errors}.confirmationMismatch`],
    ['network', `${errors}.network`],
    ['failed', `${errors}.deleteFailed`],
  ])('of an account deletion: %s', (refusal, key) => {
    expect(accountDeletionRefusalKey(refusal)).toBe(key);
  });
});

/**
 * The mailed link that sets a password (operator ruling 351).
 *
 * Marie made her account by a mailed sign-in link and never chose a password. The auth server
 * cannot tell her account from one with a password, so the account deletion asks her a current
 * password she does not have. The delete dialog now offers the link the change-password box
 * had. That box read every answer of the door as "sent", a throttle and a server fault too.
 */
describe('the mailed link that sets a password', () => {
  const ask = () => requestPasswordSetLink(API, 'marie@example.com');

  it('asks the reset door for her address, once', async () => {
    const fetched = answers(response(202, { message: 'If this email is registered' }));

    expect(await ask()).toBe('sent');

    expect(fetched).toHaveBeenCalledTimes(1);
    const [url, init] = fetched.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${API}/api/v1/auth/public-password-reset`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ email: 'marie@example.com' });
  });

  it.each([
    ['a throttle', response(429, { status: 429, code: 'TOO_MANY_REQUESTS' })],
    ['a server error', response(500, { status: 500, code: 'INTERNAL_SERVER_ERROR' })],
    ['a 503 of the edge', response(503)],
  ])('reads %s as a link that was not sent', async (_what, answer) => {
    answers(answer);

    expect(await ask()).toBe('failed');
  });

  it('reads a lost connection as its own answer', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    expect(await ask()).toBe('network');
  });

  it('says each failure with its own sentence', () => {
    expect(passwordSetLinkRefusalKey('network')).toBe('publicApp.security.errors.network');
    expect(passwordSetLinkRefusalKey('failed')).toBe(
      'publicApp.security.errors.setPasswordLinkFailed',
    );
  });

  const link = readFileSync(join(__dirname, 'PasswordSetLink.tsx'), 'utf8');

  it('sends through the request module and says what it answered', () => {
    expect(link).toContain('const answer = await requestPasswordSetLink(apiUrl, to);');
    expect(link).toContain("if (answer === 'sent') setSent(true);");
    expect(link).toContain('else setError(t(passwordSetLinkRefusalKey(answer)));');
    expect(link).toContain("t('publicApp.security.forgotPasswordSent', { email })");
    expect(link).toContain('onClick={() => void send(email)}');
    expect(link).toContain('if (!email) return null;');
  });

  it('is offered by both sections that ask the current password, each with its own words', () => {
    const page = readFileSync(join(__dirname, 'page.tsx'), 'utf8');
    const deletion = page.slice(page.indexOf('function DeleteAccountSection'));
    const change = page.slice(page.indexOf('function ChangePasswordSection'), -deletion.length);
    const offered = (label: string) =>
      new RegExp(
        `<PasswordSetLink\\s+apiUrl=\\{apiUrl\\}\\s+email=\\{status\\.email\\}\\s+` +
          `label=\\{t\\('publicApp\\.security\\.${label}'\\)\\}\\s+t=\\{t\\}\\s+/>`,
      );

    expect(change).toMatch(offered('forgotPasswordLink'));
    expect(deletion).toMatch(offered('neverSetPasswordLink'));
    // Only an account that is asked a password is offered the link.
    expect(deletion).toMatch(
      /\{status\.hasPassword && \(\s+<>\s+<PasswordField[^>]+\/>\s+<PasswordSetLink/,
    );
    expect(page).not.toContain('/api/v1/auth/public-password-reset');
  });
});

/**
 * The personal pages while the auth server gives no answer (operator ruling 353).
 *
 * The security status cannot say then how the account signs in: a server error. The shell
 * asked it on every personal page for its footer, and the settings hub for the address:
 * both read `/me` now, which answers. Only the security page asks the status, and it keeps
 * the data export, which needs nothing of it.
 */
describe('the readers of the security status', () => {
  const source = (path: string) => readFileSync(join(__dirname, '..', '..', '..', path), 'utf8');
  const shell = source('src/components/PublicPersonalShell.tsx');
  const hub = source('app/me/settings/AccountSection.tsx');

  it('are not the shell and not the settings hub', () => {
    expect(shell).not.toContain('security-status');
    expect(hub).not.toContain('security-status');
  });

  it('the shell draws its footer from the read of who is signed in', () => {
    expect(shell).toContain(
      'setAccount({ email: decision.email, viaGoogle: decision.viaGoogle });',
    );
    expect(shell).toMatch(
      /\{account\.viaGoogle && \(\s+<p [^>]+>\s+\{t\('publicApp\.personalShell\.viaGoogle'\)\}/,
    );
    expect(shell.match(/useEffect\(/g)).toHaveLength(2);
  });

  it('the settings hub shows the address `/me` hands', () => {
    expect(hub).toContain('void fetchMe(apiUrl, { signal: controller.signal }).then((me) => {');
    expect(hub).toContain('if (me.ok) setEmail(me.data.user?.email || null);');
    expect(hub).toContain("{email ?? t('common.unknown')}");
  });

  it('the security page keeps the data export when its status read failed', () => {
    const page = readFileSync(join(__dirname, 'page.tsx'), 'utf8');
    expect(page).toMatch(
      /\{statusError && \(\s+<>\s+<p [^>]+>\s+\{t\('publicApp\.security\.loadError'\)\}\s+<\/p>\s+<DataAndPrivacySection apiUrl=\{apiUrl\} t=\{t\} \/>\s+<\/>\s+\)\}/,
    );
    expect(page.match(/<DataAndPrivacySection /g)).toHaveLength(2);
    expect(page.match(/<DeleteAccountSection /g)).toHaveLength(1);
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

  it('reads its status through the request module, and leaves only for an ended session', () => {
    expect(page).toContain('readSecurityStatus(apiUrl, controller.signal)');
    expect(page).not.toContain('/api/v1/me/security-status');
    expect(page).toContain("if (read === 'session_ended') window.location.replace('/login');");
  });

  it('leaves a deleted account with no word of a lost connection', () => {
    const deletion = page.slice(page.indexOf('function DeleteAccountSection'));
    expect(deletion).toContain("await leaveDeletedAccount('/?account_deleted=1');");
    expect(deletion).toMatch(/if \(answer !== 'ok'\) \{\s+setBusy\(false\);/);
    expect(deletion).not.toContain('} catch');
    expect(deletion).not.toContain('publicApp.security.errors.network');
  });

  it('says the ended session in both sections, with the way back to the sign-in page', () => {
    expect(
      page.match(/if \(answer === 'session_ended'\) setSessionEnded\(true\);\s+else setError/g),
    ).toHaveLength(2);
    expect(page.match(/^\s+setSessionEnded\(false\);$/gm)).toHaveLength(3);
    expect(page.match(/\{sessionEnded && <SessionEnded t=\{t\} \/>\}/g)).toHaveLength(2);
    const notice = readFileSync(join(__dirname, 'SessionEnded.tsx'), 'utf8');
    expect(notice).toContain("t('publicApp.security.errors.sessionEnded')");
    expect(notice).toContain('<Link href="/login"');
  });
});
