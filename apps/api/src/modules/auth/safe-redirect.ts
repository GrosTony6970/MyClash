/** A stand-in for our own site: only whether an address LEAVES it is read. */
const OUR_SITE = 'https://our-site.invalid';

/**
 * Where a sign-in may send its reader: a path of our own site, as it was
 * asked, or the home page.
 *
 * A path begins with a slash, but so does `//host`, which a browser reads as
 * another site, and `/\host`, and `/<tab>/host`, which it reads the same way.
 * So the address is resolved as a browser resolves it (`URL` is the same
 * parser), and it is kept only when that stays on the site it started from.
 * `/.//host` stays on it, as the path `//host`: the router reads that path a
 * second time when it falls back to a page load, so it is refused too.
 * The list of prefixes this replaces held `/`, so it refused nothing.
 */
export function safeRedirectPath(asked: string | undefined): string {
  if (!asked?.startsWith('/') || !URL.canParse(asked, OUR_SITE)) return '/';
  const read = new URL(asked, OUR_SITE);
  return read.origin === OUR_SITE && !read.pathname.startsWith('//') ? asked : '/';
}
