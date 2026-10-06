import { describe, expect, it } from 'vitest';
import { isOwnSitePath } from './own-site-path';

/**
 * An address a screen was given and then moves a browser to.
 *
 * Somebody sends Marie the address of a real page of ours with `?return=/\bad-site.test`
 * behind it. The page opens as normal. Its Back link carries that address, and a browser
 * reads `/\host` as "another site": one click and she is there. Proven in a browser on the
 * pad's bout page, and on both Google callback pages for `?next=//bad-site.test`.
 *
 * An address of ours begins with one slash, and a browser that resolves it stays on the site.
 */
const OFF_SITE = [
  '//bad-site.test/landing',
  '///bad-site.test',
  '/\\bad-site.test/landing',
  '/\\/bad-site.test',
  '/\t/bad-site.test',
  '/\n/bad-site.test',
  'https://bad-site.test/landing',
  '\\\\bad-site.test',
  'javascript:alert(1)',
  'me',
  '//[',
  // On our site at the first read, as the path `//bad-site.test`: off it at the second.
  '/.//bad-site.test',
  '/..//bad-site.test',
  '/e/..//bad-site.test',
  '/%2e//bad-site.test',
  '/%2e%2e//bad-site.test',
  '/./\\bad-site.test',
  '/.\t//bad-site.test',
];

describe('isOwnSitePath', () => {
  it.each(OFF_SITE)('refuses %j', (asked) => {
    expect(isOwnSitePath(asked)).toBe(false);
  });

  it.each([undefined, null, ''])('refuses %j', (asked) => {
    expect(isOwnSitePath(asked)).toBe(false);
  });

  // The paths our screens send today, and three shapes that only look like the refused ones.
  it.each([
    '/',
    '/me',
    '/dashboard',
    '/lices',
    '/org/lyon-amhe',
    '/e/spring-open/claim?personId=row-1',
    '/e/spring-open/w/longsword-basics',
    '/e/spring-open/t/longsword?tab=pools#matches',
    '/me?claimRefused=held_by_another#top',
    '/e/a//b',
    '/e/spring-open/../autumn-open',
  ])('takes %j', (asked) => {
    expect(isOwnSitePath(asked)).toBe(true);
  });
});
