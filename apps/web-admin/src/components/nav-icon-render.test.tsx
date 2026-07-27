// Explicit React import: this app's vitest transform uses the classic JSX
// runtime, so `<NavIcon />` compiles to `React.createElement` and needs the
// binding in scope. (The Next build uses the automatic runtime; only tests
// care.)
import React from 'react';
import { NAV_ICON_NAMES, NavIcon } from '@myclash/ui';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

/**
 * The registry test in @myclash/ui proves every slug RESOLVES to a glyph. This
 * one proves a glyph actually renders, and renders with the two attributes the
 * sidebar depends on:
 *
 *   - `stroke="currentColor"` — a nav row is muted at rest and white on the red
 *     active row, and the icon has to follow the row rather than carry a colour
 *     of its own. The bordered gold tile this replaced did carry its own, and
 *     needed a second set of classes for the active state.
 *   - `aria-hidden` — every row has a visible text label, so an announced icon
 *     would just duplicate it.
 *
 * It lives in web-admin rather than beside the component because packages/ui
 * resolves react-dom against a different react copy than lucide imports, and
 * server-rendering any context-reading component there throws.
 */
describe('NavIcon rendering', () => {
  it('renders an svg that inherits the row colour and stays out of the a11y tree', () => {
    const html = renderToStaticMarkup(<NavIcon name="reviewQueue" />);

    expect(html).toContain('<svg');
    expect(html).toContain('stroke="currentColor"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('h-5 w-5 shrink-0');
  });

  it('renders every declared glyph', () => {
    for (const name of NAV_ICON_NAMES) {
      expect(renderToStaticMarkup(<NavIcon name={name} />), name).toContain('<svg');
    }
  });
});
