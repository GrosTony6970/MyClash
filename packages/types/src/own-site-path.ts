/** A stand-in for our own site: only whether an address LEAVES it is read. */
const OUR_SITE = 'https://our-site.invalid';

/**
 * Is this address a path of our own site? The ONE rule for an address a screen
 * or a sign-in was GIVEN (`?next=`, `?return=`, `redirectTo`) and then moves a
 * browser to. The API's sign-in doors, the pad's Back link and the public bout
 * page's Back link all ask it.
 *
 * A path begins with a slash, but so does `//host`, which a browser reads as
 * another site, and `/\host`, and `/<tab>/host`, which it reads the same way.
 * So the address is resolved as a browser resolves it (`URL` is the same
 * parser), and it passes only when that stays on the site it started from.
 * `/.//host` stays on it, as the path `//host`: the router reads that path a
 * second time when it falls back to a page load, so it is refused too.
 *
 * `new URL` in a `try`, not `URL.canParse`: this runs on a referee's tablet,
 * and an older browser has no `canParse`.
 */
export function isOwnSitePath(asked: string | null | undefined): asked is string {
  if (!asked?.startsWith('/')) return false;
  try {
    const read = new URL(asked, OUR_SITE);
    return read.origin === OUR_SITE && !read.pathname.startsWith('//');
  } catch {
    return false;
  }
}
