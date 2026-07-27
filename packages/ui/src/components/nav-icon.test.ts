import { describe, it, expect } from 'vitest';
import { NAV_ICON_NAMES, NAV_ICON_GLYPHS } from './NavIcon';

/**
 * The registry is typed `Record<NavIconName, LucideIcon>`, so TypeScript already
 * rejects a missing entry. These assertions cover what the type cannot:
 *
 *   - a slug listed twice in NAV_ICON_NAMES (the union swallows the duplicate
 *     silently, and the second entry in the object literal wins);
 *   - a glyph that resolved to `undefined` because an upstream rename turned a
 *     named import into a hole — which renders nothing at all, on a nav row
 *     that still has its label, so nobody notices for a release.
 */
describe('nav icon registry', () => {
  it('lists every slug exactly once', () => {
    const seen = new Set(NAV_ICON_NAMES);
    expect(seen.size).toBe(NAV_ICON_NAMES.length);
  });

  it('resolves every slug to a renderable glyph', () => {
    // lucide 1.x ships each icon as a forwardRef OBJECT, not a plain function
    // — so accept either, rather than pinning the assertion to one of the two
    // shapes React allows as an element type.
    const isRenderable = (glyph: unknown) =>
      typeof glyph === 'function' ||
      (typeof glyph === 'object' && glyph !== null && '$$typeof' in glyph);

    const holes = NAV_ICON_NAMES.filter((name) => !isRenderable(NAV_ICON_GLYPHS[name]));
    expect(holes).toEqual([]);
  });

  it('has no glyph the names list does not declare', () => {
    expect(Object.keys(NAV_ICON_GLYPHS).sort()).toEqual([...NAV_ICON_NAMES].sort());
  });

  // Actually RENDERING a glyph is asserted from apps/web-admin
  // (nav-icon-render.test.tsx): this package resolves react-dom against a
  // different react copy than the one lucide imports, so react-dom/server here
  // throws "Invalid hook call" on any component that reads context — which
  // every lucide 1.x icon does.
});
