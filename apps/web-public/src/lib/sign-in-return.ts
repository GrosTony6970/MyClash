import { isOwnSitePath } from '@myclash/types';
import { isSignInDoor } from './sign-in-doors';

/** Where sign-in lands when it was given no page to return to. */
export const AFTER_SIGN_IN = '/me';

/**
 * A page sign-in may return to: a path of our own site (`isOwnSitePath`, the
 * one rule for an address a page was GIVEN) that is not itself a sign-in page.
 * Returning to `/login` after signing in would show the form to somebody who
 * just filled it.
 */
function returnable(asked: unknown): asked is string {
  if (typeof asked !== 'string' || !isOwnSitePath(asked)) return false;
  return !isSignInDoor(asked.split(/[?#]/)[0]);
}

/**
 * The sign-in page's address for a door on the page `from`: signing in returns
 * there (quick win F11). The ONE builder for every door of the public site.
 */
export function loginHref(from: string | null | undefined): string {
  return returnable(from) ? `/login?next=${encodeURIComponent(from)}` : '/login';
}

/**
 * Where a visitor lands after signing in: the page the sign-in page was given
 * in `?next=`, when it is one sign-in may return to; else their own space.
 * `next` is read from an address anybody can write: `//host` is another site.
 */
export function afterSignIn(next: string | string[] | undefined | null): string {
  const asked = Array.isArray(next) ? next[0] : next;
  return returnable(asked) ? asked : AFTER_SIGN_IN;
}
