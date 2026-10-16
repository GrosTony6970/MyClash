import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Button } from './Button';

/**
 * The neutral outline of the shared Button (operator ruling 2026-10-16). The public site's
 * Share button was drawn by hand because the Button had no neutral style on tokens: `back` is
 * white and slate, right on a light page and wrong on a dark one. `outline` spends tokens only,
 * so it follows the scope it sits in.
 */
describe('Button variant="outline"', () => {
  const html = renderToStaticMarkup(<Button variant="outline">Share</Button>);
  const classes = /class="([^"]*)"/.exec(html)?.[1].split(' ') ?? [];

  it('draws its border, text and hover on tokens', () => {
    for (const token of [
      'border-border',
      'text-foreground-secondary',
      'hover:bg-background',
      'hover:border-muted',
    ]) {
      expect(classes).toContain(token);
    }
  });

  it('spends no raw palette colour', () => {
    const raw = classes.filter((c) =>
      /(^|:)(bg|text|border)-(white|black|slate|gray|zinc|neutral|blue|red|amber)(-|$)/.test(c),
    );
    expect(raw).toEqual([]);
  });
});
