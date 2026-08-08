import { randomInt } from 'node:crypto';
import { PASSWORD_SPECIAL_CHARS, validatePassword } from '@myclash/types';

const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIGIT = '0123456789';
const POOLS = [LOWER, UPPER, DIGIT, PASSWORD_SPECIAL_CHARS];
const ALL = POOLS.join('');

/**
 * 24 characters, which is both comfortably above the 12-character floor and
 * the length `admin-users.service.test.ts` pins. At ~89 usable characters that
 * is roughly 155 bits — more than the 144 the old base64url version carried.
 */
const LENGTH = 24;

/** Unbiased: `randomBytes(1) % pool.length` is skewed unless the pool divides 256. */
function pick(pool: string): string {
  return pool[randomInt(pool.length)] as string;
}

/** Fisher–Yates, so the guaranteed characters do not sit in a fixed order. */
function shuffle(chars: string[]): string[] {
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j] as string, chars[i] as string];
  }
  return chars;
}

/**
 * A one-time password for an account the platform creates on someone's behalf.
 *
 * Built from explicit pools with one character guaranteed from each class,
 * rather than drawn from a single alphabet and hoped over: it must satisfy
 * `validatePassword` every time, because GoTrue now enforces the same rules
 * (GOTRUE_PASSWORD_MIN_LENGTH + GOTRUE_PASSWORD_REQUIRED_CHARACTERS) and these
 * values are set through its admin API.
 *
 * This used to be `randomBytes(18).toString('base64url')`, exempted from the
 * policy on the argument that a 144-bit random string is not the risk the
 * policy guards against. The argument was sound but the exemption stopped
 * being affordable once GoTrue became the boundary: base64url's only
 * punctuation is `-` and `_`, so 46.7% of generated values carried no special
 * character at all and 47.7% failed the full rule set. That is a coin flip on
 * every org-owner creation, not an edge case.
 *
 * One owner: this used to exist twice, as a private method on both
 * AdminUsersService and AdminOrganizationsService. Two copies of "how strong is
 * a temporary credential" is one copy too many.
 */
export function generateTemporaryPassword(): string {
  const chars = POOLS.map(pick);
  while (chars.length < LENGTH) chars.push(pick(ALL));
  const password = shuffle(chars).join('');

  // Asserted rather than trusted: one pass over 24 characters, and it turns a
  // future edit that breaks the class guarantee into a loud failure here
  // instead of a confusing 422 from GoTrue during an org-owner creation.
  const validation = validatePassword(password);
  if (!validation.ok) {
    throw new Error(`Generated temporary password failed: ${validation.failing.join(', ')}`);
  }
  return password;
}
