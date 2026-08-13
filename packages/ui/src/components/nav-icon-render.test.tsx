import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { NAV_ICON_NAMES, NavIcon } from './NavIcon';

/**
 * nav-icon.test.ts proves every slug resolves to a vendored glyph and
 * nav-icon-glyphs.test.ts proves the artwork still matches lucide. This one
 * proves a glyph actually renders, with the two attributes the sidebar depends
 * on:
 *
 *   - `stroke="currentColor"` — a nav row is muted at rest and white on the red
 *     active row, and the icon has to follow the row rather than carry a colour
 *     of its own. The bordered gold tile this replaced did carry its own, and
 *     needed a second set of classes for the active state.
 *   - `aria-hidden` — every row has a visible text label, so an announced icon
 *     would just duplicate it.
 *
 * It used to live in apps/web-admin, because lucide 1.x icons read a context on
 * every render and this package resolved react-dom against a different react
 * copy than lucide imported, so server-rendering one threw "Invalid hook call".
 * `Glyph` reads nothing, so the assertion can sit next to the component.
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

  it('draws geometry rather than an empty frame', () => {
    // The old lucide-backed registry test caught a named import that had gone
    // missing upstream and rendered nothing. The vendored equivalent of that
    // hole is a glyph whose node list survived generation but drew no shape.
    for (const name of NAV_ICON_NAMES) {
      expect(renderToStaticMarkup(<NavIcon name={name} />), name).toMatch(
        /<(path|circle|rect|line|polyline|polygon|ellipse)\b/,
      );
    }
  });
});
