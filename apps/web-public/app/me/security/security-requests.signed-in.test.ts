import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { en, fr } from '@myclash/i18n';
import { passwordChangedKey, requestPasswordChange } from './security-requests';

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

// web-public's vitest compiles no TSX: the screens are read as text.
describe('the screens that speak after a password write', () => {
  const read = (...parts: string[]) => readFileSync(join(__dirname, ...parts), 'utf8');

  it('the change-password box says the sentence of its answer', () => {
    const page = read('page.tsx');

    expect(page).toContain("if (answer !== 'ok' && answer !== 'sign_in_again') {");
    expect(page).toContain('setMessage(t(passwordChangedKey(answer)));');
    expect(page).not.toContain('publicApp.security.changePasswordSuccess');
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
