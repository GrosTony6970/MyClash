import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { en, fr } from '@myclash/i18n';
import { missingField } from './missing-field';

describe('missingField', () => {
  it('asks for the email first', () => {
    expect(missingField('', '', true)).toBe('email');
    expect(missingField('   ', 'secret', true)).toBe('email');
    expect(missingField('', '', false)).toBe('email');
  });

  it('asks for the password only where the action needs one', () => {
    expect(missingField('lea@example.test', '', true)).toBe('password');
    expect(missingField('lea@example.test', '', false)).toBeNull();
  });

  it('asks for nothing when both are typed', () => {
    expect(missingField('lea@example.test', 'secret', true)).toBeNull();
  });

  it('does not trim a password: spaces are a password', () => {
    expect(missingField('lea@example.test', '   ', true)).toBeNull();
  });
});

/**
 * web-public's vitest compiles no TSX: the form's wiring is read as text. The
 * browser stories of `tests/a11y/public-login.spec.ts` press the keys.
 */
describe('the participant sign-in page is a form', () => {
  const page = readFileSync(join(__dirname, 'page.tsx'), 'utf8');

  it('sends by its form, so Enter and a password manager work', () => {
    expect(page).toContain('<form className="space-y-4" noValidate onSubmit={submit}>');
    // One submit button per tab: sign in, create an account, send the reset link.
    expect(page.match(/type="submit"/g)).toHaveLength(3);
  });

  it('no action returns in silence over an empty field', () => {
    expect(page).not.toContain('if (!email.trim()');
    expect(page.match(/nothingMissing\((true|false)\)/g)).toHaveLength(4);
  });

  it('says which field, in both languages', () => {
    expect(en.publicApp.login.errors.emailRequired).toBe('Enter your email address.');
    expect(fr.publicApp.login.errors.emailRequired).toBe('Saisissez votre adresse email.');
    expect(en.publicApp.login.errors.passwordRequired).toBe('Enter your password.');
    expect(fr.publicApp.login.errors.passwordRequired).toBe('Saisissez votre mot de passe.');
  });
});
