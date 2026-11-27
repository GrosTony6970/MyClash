import { describe, expect, it } from 'vitest';
import { hasSidebarShell } from './AppLegalFooter';

/**
 * The personal space shows the legal links under Log out, so the page footer
 * must stay away there — or it pops up as a band at the bottom of the scroll,
 * and the links show twice.
 */
describe('hasSidebarShell', () => {
  it.each(['/me', '/me/', '/me/profile', '/me/events/ev1'])(
    '%s has a sidebar, so no page footer',
    (path) => {
      expect(hasSidebarShell(path)).toBe(true);
    },
  );

  it.each(['/', '/e/open-2026', '/login', '/fighters', '/members', '/meetups'])(
    '%s has no sidebar, so the page footer stays',
    (path) => {
      expect(hasSidebarShell(path)).toBe(false);
    },
  );

  it('reads no path as no sidebar', () => {
    expect(hasSidebarShell(null)).toBe(false);
  });
});
