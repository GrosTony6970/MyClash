import { describe, it, expect } from 'vitest';
import { authAltLinkClass, authFieldClass, authNoticeClass, authTabClass } from './AuthPanel';

/**
 * There is no DOM harness in this package, so these cover the parts of the auth
 * shell that are decidable without one — the class strings both logins now
 * share. They exist because the failure they guard is silent: a token swapped
 * for a raw colour, or an accent class dropped from the active tab, renders
 * perfectly and just stops matching the other app.
 */
describe('auth panel classes', () => {
  it('paints the active tab with the accent and leaves the rest muted', () => {
    expect(authTabClass(true)).toContain('bg-accent');
    expect(authTabClass(true)).toContain('text-accent-foreground');
    expect(authTabClass(false)).not.toContain('bg-accent');
    expect(authTabClass(false)).toContain('text-muted');
  });

  it('keeps both tab states on the same box model', () => {
    // Only the colour may differ between states — a width or padding change
    // would make the track twitch as the tab moves.
    const box = ['flex-1', 'rounded-md', 'px-3', 'py-2', 'text-sm'];
    for (const cls of box) {
      expect(authTabClass(true)).toContain(cls);
      expect(authTabClass(false)).toContain(cls);
    }
  });

  it('separates the notice tones by semantic token', () => {
    expect(authNoticeClass('success')).toContain('text-success');
    expect(authNoticeClass('error')).toContain('text-danger');
    expect(authNoticeClass('success')).not.toContain('danger');
    expect(authNoticeClass('error')).not.toContain('success');
  });

  it('builds fields from semantic tokens only', () => {
    // The two apps' hand-copied field classes had already drifted; the point of
    // hoisting it here is that it stays tokenized and stays one string.
    expect(authFieldClass).toContain('border-border');
    expect(authFieldClass).toContain('bg-background');
    expect(authFieldClass).toContain('text-foreground');
    expect(authFieldClass).toContain('focus:border-accent');
    expect(authFieldClass).not.toMatch(/\b(?:bg|text|border)-(?:slate|gray|zinc|white|black)\b/);
  });

  it('writes the cross-app link in the panel ink with an underline, not in the accent', () => {
    // The panel is a dark scope and the accent does not lighten there: the red link was 2.3:1 on
    // the panel's card and the blue one 2.2:1 (known-deviations D27). The underline is what says
    // "link" now, so it is always on; theme-ink-contrast.test.ts measures the ink.
    const classes = authAltLinkClass.split(' ');
    expect(classes).toContain('text-foreground');
    expect(classes).toContain('underline');
    expect(authAltLinkClass).not.toContain('accent');
    expect(authAltLinkClass).not.toMatch(/\b(?:bg|text|border)-(?:slate|gray|zinc|white|black)\b/);
  });
});
