import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { en, fr } from '@myclash/i18n';

/**
 * The organiser reset page says "you are signed in" only when the door handed a login
 * (operator ruling 358).
 *
 * Claire sets a new password from her reset mail. The API writes it, and the fresh login
 * never comes: the auth server hangs, or this browser held another account's login. The
 * page said "You are signed in. Continue to your workspace." and its button landed on the
 * sign-in screen. It reads the door's `signedIn` now. The page is pinned as text.
 */
const page = readFileSync(join(__dirname, 'page.tsx'), 'utf8');

describe('the organiser reset page, after the password is written', () => {
  it('reads whether the door handed a login, and takes a missing word as no', () => {
    expect(page).toContain("setPhase(body?.signedIn === true ? 'done' : 'sign-in');");
    expect(page).not.toContain("setPhase('done');");
  });

  it('says to sign in, with a button to the sign-in screen, when it handed none', () => {
    expect(page).toMatch(
      /\{phase === 'sign-in' \? \([^?]*\{t\('auth\.resetPassword\.doneSignIn'\)\}[^?]*<a href="\/login">\{t\('auth\.login\.signIn'\)\}<\/a>[^?]*\) : phase === 'done' \? \(/,
    );
  });

  it('keeps "you are signed in" and the dashboard for the login it handed', () => {
    expect(page).toMatch(
      /\) : phase === 'done' \? \([^?]*\{t\('auth\.resetPassword\.doneDescription'\)\}[^?]*<a href="\/dashboard">/,
    );
  });

  it('offers no way back to the form once the password is written', () => {
    expect(page).toContain("phase === 'done' || phase === 'sign-in' ? undefined : (");
  });

  it('is these words', () => {
    expect(en.auth.resetPassword.doneSignIn).toBe('Sign in with your new password.');
    expect(fr.auth.resetPassword.doneSignIn).toBe(
      'Connectez-vous avec votre nouveau mot de passe.',
    );
  });
});
