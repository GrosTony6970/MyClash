import { validatePassword } from '@myclash/types';

/**
 * The organizer auth form's decisions, with no React and no i18n in them.
 *
 * Validation returns a CODE, not a translated sentence: the i18n reverse sweep
 * only sees `t('a.b')` literals in source, so a helper that returned key
 * strings would make every one of those keys look orphaned and get pruned. The
 * component maps codes to keys; this file stays testable.
 */
export type AuthFormCode =
  | 'legal_required'
  | 'email_invalid'
  | 'display_name_required'
  | 'password_weak'
  | 'password_mismatch'
  | 'org_name_required'
  | 'slug_too_short'
  | 'slug_unavailable';

/** Which credential the account being created will carry. */
export type SignupIntent = 'password' | 'magic_link' | 'google';

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const SLUG_MIN_LENGTH = 3;

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip accents
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

/** Everything a slug input may contain, filtered as it is typed. */
export function normalizeSlugInput(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9-]/g, '');
}

export interface AccountStepInput {
  intent: SignupIntent;
  acceptedLegal: boolean;
  email: string;
  displayName: string;
  password: string;
  passwordConfirm: string;
}

export function validateAccountStep(input: AccountStepInput): AuthFormCode | null {
  // Checked before the google early-return: every intent creates an account, so
  // every intent needs the agreement.
  if (!input.acceptedLegal) return 'legal_required';
  // Google carries the address and the name itself; there is nothing here to
  // check until it comes back.
  if (input.intent === 'google') return null;
  if (!EMAIL_PATTERN.test(input.email)) return 'email_invalid';
  if (input.displayName.trim().length < 2) return 'display_name_required';
  if (input.intent === 'password') {
    // The shared rule, not a local length check. This form creates the ORG
    // OWNER, and it used to admit 8 characters while the public app demanded 12
    // plus four classes.
    if (!validatePassword(input.password).ok) return 'password_weak';
    if (input.password !== input.passwordConfirm) return 'password_mismatch';
  }
  return null;
}

export interface OrgStepInput {
  orgName: string;
  orgSlug: string;
  slugAvailable: boolean | null;
}

export function validateOrgStep(input: OrgStepInput): AuthFormCode | null {
  if (!input.orgName.trim()) return 'org_name_required';
  if (input.orgSlug.length < SLUG_MIN_LENGTH) return 'slug_too_short';
  // `null` is "not checked yet" — an unanswered lookup must not block the
  // submit, because the server rejects a taken slug anyway.
  if (input.slugAvailable === false) return 'slug_unavailable';
  return null;
}
