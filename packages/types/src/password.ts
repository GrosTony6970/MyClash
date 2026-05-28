/**
 * Password validation rules shared by every place that accepts a
 * user-chosen password: public sign-up form, password reset, password
 * change. Both client (live checklist UI) and server (defensive
 * validation) import this so the rules stay aligned.
 *
 * Rules: at least 12 characters, with at least one uppercase letter,
 * one lowercase letter, one digit, and one special character (anything
 * non-alphanumeric — punctuation, symbols, whitespace all count).
 */

export const PASSWORD_MIN_LENGTH = 12;

export type PasswordRule = 'length' | 'uppercase' | 'lowercase' | 'digit' | 'special';

export type PasswordValidationResult = {
  ok: boolean;
  failing: PasswordRule[];
};

const RULE_CHECKS: ReadonlyArray<{ rule: PasswordRule; check: (p: string) => boolean }> = [
  { rule: 'length', check: (p) => p.length >= PASSWORD_MIN_LENGTH },
  { rule: 'uppercase', check: (p) => /[A-Z]/.test(p) },
  { rule: 'lowercase', check: (p) => /[a-z]/.test(p) },
  { rule: 'digit', check: (p) => /[0-9]/.test(p) },
  { rule: 'special', check: (p) => /[^A-Za-z0-9]/.test(p) },
];

export function validatePassword(password: string): PasswordValidationResult {
  const failing: PasswordRule[] = [];
  for (const { rule, check } of RULE_CHECKS) {
    if (!check(password)) failing.push(rule);
  }
  return { ok: failing.length === 0, failing };
}
