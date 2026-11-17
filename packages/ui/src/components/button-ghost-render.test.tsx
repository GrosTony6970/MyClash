import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Button } from './Button';

/**
 * The ghost button follows the scope it sits in. It was raw white in every scope
 * (`text-white border-white/20`): right on the dark sign-in panels, and white on white on a light
 * page. Rendered on 2026-11-17, Delete on the admin photo tile, Block on a FightBook card and
 * Cancel in a FightBook dialog could not be seen at all (known-deviations D13). It now spends the
 * scope's own ink, `foreground`, at the same opacity steps.
 */
describe('Button variant="ghost"', () => {
  const html = renderToStaticMarkup(<Button variant="ghost">Cancel</Button>);
  const classes = (/class="([^"]*)"/.exec(html)?.[1] ?? '').split(' ');

  it('draws its text, border and hover on the scope ink', () => {
    for (const token of [
      'text-foreground',
      'border-foreground/20',
      'hover:border-foreground/40',
      'hover:bg-foreground/10',
      'active:bg-foreground/20',
    ]) {
      expect(classes).toContain(token);
    }
  });

  it('spends no raw palette colour', () => {
    const raw = classes.filter((c) =>
      /(^|:)(bg|text|border)-(white|black|slate|gray|zinc|neutral|blue|red|amber)(-|\/|$)/.test(c),
    );
    expect(raw).toEqual([]);
  });
});
