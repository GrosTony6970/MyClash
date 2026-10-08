import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { en, fr } from '@myclash/i18n';
import {
  accountDeletionRefusalKey,
  passwordChangeRefusalKey,
  passwordChangedKey,
  requestAccountDeletion,
  requestPasswordChange,
} from './security-requests';

/**
 * A page says "you are signed in" only when the door handed a login (operator ruling 358).
 *
 * Paul changes his password. The API writes it, then asks the auth server for a fresh login
 * and gets none (it hangs, or the browser held another account's login). The door answers
 * "done" and clears the browser's login. The pages said he was signed in. Each door now says
 * whether it handed a login, and with none the page says "sign in with your new password".
 */
const API = 'https://api.example.test';

const answers = (body: object) =>
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  );

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the answer of a password change', () => {
  const change = () => requestPasswordChange(API, 'current', 'A-much-Longer-passw0rd!');

  it('is ok when the door handed a login', async () => {
    answers({ ok: true, signedIn: true });

    expect(await change()).toBe('ok');
  });

  it.each([
    ['said it handed none', { ok: true, signedIn: false }],
    ['did not say', { ok: true }],
    ['said something else', { ok: true, signedIn: 'yes' }],
  ])('is "sign in again" when the door %s', async (_what, body) => {
    answers(body);

    expect(await change()).toBe('sign_in_again');
  });
});

describe('the sentence after a password write', () => {
  it('is one key per answer', () => {
    expect(passwordChangedKey('ok')).toBe('publicApp.security.changePasswordSuccess');
    expect(passwordChangedKey('sign_in_again')).toBe('publicApp.resetPassword.doneSignIn');
  });

  it('is these words with no login', () => {
    expect(en.publicApp.resetPassword.doneSignIn).toBe(
      'Password updated. Sign in with your new password.',
    );
    expect(fr.publicApp.resetPassword.doneSignIn).toBe(
      'Mot de passe mis à jour. Connectez-vous avec votre nouveau mot de passe.',
    );
  });
});

// Ruling 359: ten checks of a current password an hour. The eleventh said "Try again."
describe('a door that counted too many tries', () => {
  const refused = () =>
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ code: 'HTTP_429', detail: 'Too Many Requests' }), {
          status: 429,
          headers: { 'Content-Type': 'application/problem+json' },
        }),
      ),
    );

  it('is its own answer at both doors, with one sentence', async () => {
    refused();

    expect(await requestPasswordChange(API, 'current', 'A-much-Longer-passw0rd!')).toBe(
      'throttled',
    );
    expect(await requestAccountDeletion(API, 'current', 'DELETE')).toBe('throttled');
    expect(passwordChangeRefusalKey('throttled')).toBe('publicApp.security.errors.tooManyTries');
    expect(accountDeletionRefusalKey('throttled')).toBe('publicApp.security.errors.tooManyTries');
  });

  it('is these words', () => {
    expect(en.publicApp.security.errors.tooManyTries).toBe(
      'Too many tries. Wait an hour, then try again.',
    );
    expect(fr.publicApp.security.errors.tooManyTries).toBe(
      'Trop de tentatives. Attendez une heure, puis réessayez.',
    );
  });
});

// web-public's vitest compiles no TSX: the screens are read as text.
describe('the screens that speak after a password write', () => {
  const read = (...parts: string[]) => readFileSync(join(__dirname, ...parts), 'utf8');

  it('the change-password box says the sentence of its answer', () => {
    const page = read('page.tsx');

    expect(page).toContain("if (answer !== 'ok' && answer !== 'sign_in_again') {");
    expect(page).toContain('setChanged(answer);');
    expect(page).toContain('{changed && <PasswordChangedNotice changed={changed} t={t} />}');
    expect(page).not.toContain('publicApp.security.changePasswordSuccess');
  });

  // With no login from the door the browser's login is cleared: the box must lead somewhere.
  it('the change-password box leads to the sign-in screen only when no login was handed', () => {
    const notice = read('PasswordChangedNotice.tsx');

    expect(notice).toContain('{t(passwordChangedKey(changed))}');
    expect(notice).toMatch(
      /\{changed === 'sign_in_again' && \(\s+<>\s+\{' '\}\s+<Link href="\/login" className="font-semibold underline">\s+\{t\('publicApp\.home\.signIn'\)\}\s+<\/Link>\s+<\/>\s+\)\}/,
    );
    expect(notice.match(/<Link /g)).toHaveLength(1);
  });

  it('the reset page moves to the personal space only with a login', () => {
    const page = read('..', '..', 'reset-password', 'page.tsx');

    expect(page).toMatch(
      /if \(body\?\.signedIn !== true\) \{[^}]*setPhase\('sign-in'\);\s+return;\s+\}\s+setPhase\('done'\);\s+router\.replace\('\/me\?password_reset=1'\);/,
    );
    expect(page).toContain("if (phase === 'sign-in') return <SignInWithNewPassword t={t} />;");
  });

  it('the reset page then says the sentence, with a link to the sign-in screen', () => {
    const notice = read('..', '..', 'reset-password', 'SignInWithNewPassword.tsx');

    expect(notice).toContain("{t('publicApp.resetPassword.doneSignIn')}");
    expect(notice).toContain('<Link href="/login">{t(\'publicApp.home.signIn\')}</Link>');
  });
});
