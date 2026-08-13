import { describe, it, expect } from 'vitest';
import { NAV_ICON_NAMES, NAV_ICON_GLYPHS } from './NavIcon';

/**
 * The registry is typed `Record<NavIconName, GlyphName>`, so TypeScript already
 * rejects a missing entry and an artwork name that is not vendored. These
 * assertions cover what the type cannot:
 *
 *   - a slug listed twice in NAV_ICON_NAMES (the union swallows the duplicate
 *     silently, and the second entry in the object literal wins);
 *   - a glyph entry for a slug the names list never declares.
 *
 * That the artwork itself is present, drawable and in step with lucide is
 * asserted next door in nav-icon-glyphs.test.ts.
 */
describe('nav icon registry', () => {
  it('lists every slug exactly once', () => {
    const seen = new Set(NAV_ICON_NAMES);
    expect(seen.size).toBe(NAV_ICON_NAMES.length);
  });

  it('has no glyph the names list does not declare', () => {
    expect(Object.keys(NAV_ICON_GLYPHS).sort()).toEqual([...NAV_ICON_NAMES].sort());
  });
});
