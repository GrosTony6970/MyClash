import { describe, expect, it } from 'vitest';
import { leaveTarget, type LinkClick } from './leave-guard';

const HERE = 'https://myclash.fr/me/profile';
const click = (patch: Partial<LinkClick> = {}): LinkClick => ({
  defaultPrevented: false,
  button: 0,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...patch,
});
const link = (href: string | null, patch: { target?: string | null; download?: boolean } = {}) => ({
  href,
  target: patch.target ?? null,
  download: patch.download ?? false,
});

describe('leaveTarget', () => {
  it('gives the address of a plain click on a link to another page of the site', () => {
    expect(leaveTarget(click(), link('/me/events'), HERE)).toBe('/me/events');
    expect(leaveTarget(click(), link('/me/profile?tab=referee'), HERE)).toBe(
      '/me/profile?tab=referee',
    );
    expect(leaveTarget(click(), link('https://myclash.fr/fighters?q=lea#top'), HERE)).toBe(
      '/fighters?q=lea#top',
    );
  });

  it('lets the browser handle a click that opens a new tab or a download', () => {
    for (const modified of [
      { metaKey: true },
      { ctrlKey: true },
      { shiftKey: true },
      { altKey: true },
      { button: 1 },
    ]) {
      expect(leaveTarget(click(modified), link('/me/events'), HERE), JSON.stringify(modified)).toBe(
        null,
      );
    }
    expect(leaveTarget(click(), link('/me/events', { target: '_blank' }), HERE)).toBe(null);
    expect(leaveTarget(click(), link('/me/export.csv', { download: true }), HERE)).toBe(null);
  });

  it('leaves another site, a mail link and an anchor on this page to the browser', () => {
    // Another site unloads the page: the browser's own "Leave site?" asks there.
    expect(leaveTarget(click(), link('https://hemaratings.com/x'), HERE)).toBe(null);
    expect(leaveTarget(click(), link('mailto:help@myclash.fr'), HERE)).toBe(null);
    expect(leaveTarget(click(), link('#medals'), HERE)).toBe(null);
    expect(leaveTarget(click(), link(null), HERE)).toBe(null);
  });

  it('does nothing for a click a handler already took', () => {
    expect(leaveTarget(click({ defaultPrevented: true }), link('/me/events'), HERE)).toBe(null);
  });
});
