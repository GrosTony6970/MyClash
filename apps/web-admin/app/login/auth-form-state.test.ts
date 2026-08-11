import { describe, expect, it } from 'vitest';
import {
  normalizeSlugInput,
  slugify,
  validateAccountStep,
  validateOrgStep,
  type AccountStepInput,
} from './auth-form-state';

const VALID_PASSWORD = 'Correct-Horse-9';

function account(overrides: Partial<AccountStepInput> = {}): AccountStepInput {
  return {
    intent: 'password',
    acceptedLegal: true,
    email: 'organizer@example.com',
    displayName: 'Jean Dupont',
    password: VALID_PASSWORD,
    passwordConfirm: VALID_PASSWORD,
    ...overrides,
  };
}

describe('account step', () => {
  it('accepts a complete password signup', () => {
    expect(validateAccountStep(account())).toBeNull();
  });

  it('refuses every intent without the agreement, google included', () => {
    for (const intent of ['password', 'magic_link', 'google'] as const) {
      expect(validateAccountStep(account({ intent, acceptedLegal: false }))).toBe('legal_required');
    }
  });

  it('asks google for nothing else — the provider carries the identity', () => {
    expect(
      validateAccountStep(
        account({
          intent: 'google',
          email: '',
          displayName: '',
          password: '',
          passwordConfirm: '',
        }),
      ),
    ).toBeNull();
  });

  it('skips the password rules on the magic-link intent', () => {
    // The account is created without a password at all, so demanding one here
    // would block a path the server accepts.
    expect(
      validateAccountStep(account({ intent: 'magic_link', password: '', passwordConfirm: '' })),
    ).toBeNull();
  });

  it('holds the org owner to the shared password rule', () => {
    // 'Short-1a' passes an eight-character check, which is what this form used
    // to apply while the fighter signup demanded twelve plus four classes.
    expect(
      validateAccountStep(account({ password: 'Short-1a', passwordConfirm: 'Short-1a' })),
    ).toBe('password_weak');
  });

  it('catches a mistyped confirmation', () => {
    expect(validateAccountStep(account({ passwordConfirm: `${VALID_PASSWORD}x` }))).toBe(
      'password_mismatch',
    );
  });

  it('rejects an address with no domain and a one-letter name', () => {
    expect(validateAccountStep(account({ email: 'organizer@example' }))).toBe('email_invalid');
    expect(validateAccountStep(account({ displayName: ' J ' }))).toBe('display_name_required');
  });
});

describe('organization step', () => {
  it('accepts a named organization whose slug is free', () => {
    expect(
      validateOrgStep({ orgName: 'Lyon AMHE', orgSlug: 'lyon-amhe', slugAvailable: true }),
    ).toBeNull();
  });

  it('does not block on a lookup that has not answered yet', () => {
    // `null` is "unchecked", not "taken" — the server refuses a duplicate
    // anyway, and blocking here strands anyone whose check request failed.
    expect(
      validateOrgStep({ orgName: 'Lyon AMHE', orgSlug: 'lyon-amhe', slugAvailable: null }),
    ).toBeNull();
  });

  it('names what is missing', () => {
    expect(validateOrgStep({ orgName: '  ', orgSlug: 'lyon-amhe', slugAvailable: true })).toBe(
      'org_name_required',
    );
    expect(validateOrgStep({ orgName: 'Lyon', orgSlug: 'ly', slugAvailable: true })).toBe(
      'slug_too_short',
    );
    expect(validateOrgStep({ orgName: 'Lyon', orgSlug: 'lyon-amhe', slugAvailable: false })).toBe(
      'slug_unavailable',
    );
  });
});

describe('slug derivation', () => {
  it('strips accents rather than dropping the letters', () => {
    expect(slugify('Épée & Cercle')).toBe('epee-cercle');
  });

  it('collapses runs and trims the hyphens a name leaves behind', () => {
    expect(slugify('  Lyon   AMHE!!  ')).toBe('lyon-amhe');
  });

  it('caps the slug at 50 characters', () => {
    expect(slugify('a'.repeat(80))).toHaveLength(50);
  });

  it('keeps typed input to the alphabet the URL allows', () => {
    expect(normalizeSlugInput('Lyon AMHE_2026!')).toBe('lyonamhe2026');
  });
});
