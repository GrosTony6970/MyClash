import { describe, expect, it } from 'vitest';
import { DEFAULT_BLOCK_ACCENT, DEFAULT_ORG_ACCENT, FALLBACK_BLOCK_ACCENT } from '@myclash/types';
import { SWATCH_PALETTE } from './ColorSwatchPicker';

/**
 * The picker rings whatever `defaultColor` it is handed. A default that isn't
 * in the palette rings nothing — which is how the org branding card ended up
 * showing a slate swatch beside a red preview. Guard the invariant instead of
 * trusting whoever next edits the array.
 */
describe('SWATCH_PALETTE', () => {
  it('contains every default a surface can hand to defaultColor', () => {
    const defaults = [
      DEFAULT_ORG_ACCENT,
      FALLBACK_BLOCK_ACCENT,
      ...Object.values(DEFAULT_BLOCK_ACCENT),
    ];
    const palette = SWATCH_PALETTE.map((hex) => hex.toLowerCase());
    for (const hex of defaults) expect(palette).toContain(hex.toLowerCase());
  });

  it('holds only lowercase 6-digit hexes, so selection compares cleanly', () => {
    for (const hex of SWATCH_PALETTE) expect(hex).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('has no duplicates and fills whole rows of eight', () => {
    expect(new Set(SWATCH_PALETTE).size).toBe(SWATCH_PALETTE.length);
    expect(SWATCH_PALETTE.length % 8).toBe(0);
  });
});
