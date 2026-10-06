import { isOwnSitePath } from '@myclash/types';

/**
 * Where a sign-in may send its reader: a path of our own site, as it was
 * asked, or the home page. The rule is `isOwnSitePath`, which the pad and the
 * public site ask too; the home page as the stand-in is this door's own.
 * The list of prefixes this replaced held `/`, so it refused nothing.
 */
export function safeRedirectPath(asked: string | undefined): string {
  return isOwnSitePath(asked) ? asked : '/';
}
