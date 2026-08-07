import { randomBytes } from 'node:crypto';

/**
 * A one-time password for an account the platform creates on someone's behalf.
 *
 * 18 random bytes, base64url — 144 bits, and URL/clipboard safe so an operator
 * can hand it over without an escaping accident mangling it.
 *
 * NOT run through `validatePassword` from @myclash/types, and it would often
 * fail it: base64url has no punctuation, so a generated password can miss the
 * "special character" rule. That is fine and deliberate — the policy exists to
 * stop humans choosing `password1`, and it is enforced where humans choose. A
 * 144-bit random string set through the admin API is not the risk it guards
 * against, and forcing it through the same rules would only mean rejection
 * loops on a value nobody types twice.
 *
 * One owner: this used to exist twice, as a private method on both
 * AdminUsersService and AdminOrganizationsService. Two copies of "how strong is
 * a temporary credential" is one copy too many.
 */
export function generateTemporaryPassword(): string {
  return randomBytes(18).toString('base64url');
}
