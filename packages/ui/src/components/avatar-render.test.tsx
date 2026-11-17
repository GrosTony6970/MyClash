import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Avatar } from './Avatar';

/**
 * The disc of initials a person gets when they have no photo. It was the accent with the page
 * ink on it: dark letters on red, 2.8:1, on the fighter directory, the follows and FightBook
 * (known-deviations D27). Its own comment already said "neutral, not red". It is now the `strong`
 * pair, which inverts with the scope, so it reads on a light page and in the dark sidebar.
 * `theme-ink-contrast.test.ts` measures the pair in both.
 */
describe('Avatar without a photo', () => {
  const html = renderToStaticMarkup(<Avatar name="Marie Dubois" />);
  const classes = (/class="([^"]*)"/.exec(html)?.[1] ?? '').split(' ');

  it('shows the initials', () => {
    expect(html).toContain('>MD<');
  });

  it('is the neutral strong pair', () => {
    expect(classes).toContain('bg-strong');
    expect(classes).toContain('text-strong-foreground');
  });

  it('is not the accent, and not the page ink on a fill of its own', () => {
    expect(classes).not.toContain('bg-accent');
    expect(classes).not.toContain('text-foreground');
  });
});
