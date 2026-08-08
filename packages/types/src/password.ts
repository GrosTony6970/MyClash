/**
 * Password validation rules shared by every place that accepts a
 * user-chosen password: public sign-up form, password reset, password
 * change. Both client (live checklist UI) and server (defensive
 * validation) import this so the rules stay aligned.
 *
 * Rules: at least 12 characters, with at least one uppercase letter,
 * one lowercase letter, one digit, and one character from
 * PASSWORD_SPECIAL_CHARS.
 */

export const PASSWORD_MIN_LENGTH = 12;

/**
 * ASCII punctuation, minus `:`. The one owner of what counts as "special".
 *
 * Three consumers must agree on this exact set:
 *   1. `validatePassword` below, which the API and the browser checklist share
 *   2. `generateTemporaryPassword` in the API, which draws from it
 *   3. GOTRUE_PASSWORD_REQUIRED_CHARACTERS in both compose files
 *
 * GoTrue is reachable directly at app.${DOMAIN}/auth/v1/*, so it — not our Zod
 * — is the real boundary, and it takes a finite explicit list rather than a
 * pattern. That is why this narrowed from `/[^A-Za-z0-9]/`: under the old rule
 * a password whose only special was a space or `é` ticked the checklist green
 * and was then refused by GoTrue, which is the disagreement this set exists to
 * prevent.
 *
 * `:` is absent because it is GoTrue's own group delimiter — a group
 * containing it cannot be expressed. 31 characters, not 32.
 */
export const PASSWORD_SPECIAL_CHARS = '!"#$%&\'()*+,-./;<=>?@[\\]^_`{|}~';

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
  { rule: 'special', check: (p) => [...p].some((c) => PASSWORD_SPECIAL_CHARS.includes(c)) },
];

export function validatePassword(password: string): PasswordValidationResult {
  const failing: PasswordRule[] = [];
  for (const { rule, check } of RULE_CHECKS) {
    if (!check(password)) failing.push(rule);
  }
  return { ok: failing.length === 0, failing };
}
