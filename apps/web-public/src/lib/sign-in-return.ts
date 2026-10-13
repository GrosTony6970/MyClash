import { isOwnSitePath } from '@myclash/types';
import { isSignInDoor } from './sign-in-doors';

/** Where sign-in lands when it was given no page to return to. */
export const AFTER_SIGN_IN = '/me';

/**
 * A page sign-in may return to: a path of our own site (`isOwnSitePath`, the
 * one rule for an address a page was GIVEN) that is not itself a sign-in page.
 * Returning to `/login` after signing in would show the form to somebody who
 * just filled it.
 *
 * The site's home is no page to return to either: the API's two doors (the
 * mailed link, Google) read `/` as "no page given" and land on the personal
 * space. With `/` kept here, a password sign-in from the home landed on the
 * home and the two others on the personal space.
 */
function returnable(asked: unknown): asked is string {
  if (typeof asked !== 'string' || !isOwnSitePath(asked)) return false;
  const path = asked.split(/[?#]/)[0];
  return path !== '/' && !isSignInDoor(path);
}

/**
 * The sign-in page's address for a door on the page `from`: signing in returns
 * there (quick win F11). The ONE builder for every door of the public site.
 */
export function loginHref(from: string | null | undefined): string {
  return returnable(from) ? `/login?next=${encodeURIComponent(from)}` : '/login';
}

/**
 * Leave a page whose login ended, for the sign-in page; signing in returns to
 * this page. For the browser only: every page of the personal space that meets
 * a 401 calls it.
 */
export function signInAgainHere(): void {
  window.location.replace(loginHref(window.location.pathname));
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
