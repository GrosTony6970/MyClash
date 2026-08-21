import { describe, expect, it } from 'vitest';
import { filterChipClasses } from './filter-chip-classes';

describe('filterChipClasses', () => {
  it('gives a selected chip the accent fill', () => {
    expect(filterChipClasses(true)).toBe(
      'min-h-[40px] rounded-full border px-4 py-2 text-sm font-semibold transition-colors ' +
        'border-accent bg-accent text-accent-foreground',
    );
  });

  it('gives an idle chip a surface fill and a hover that can actually be seen', () => {
    expect(filterChipClasses(false)).toBe(
      'min-h-[40px] rounded-full border px-4 py-2 text-sm font-semibold transition-colors ' +
        'border-border bg-surface text-foreground-secondary hover:border-accent hover:text-foreground',
    );
  });

  it('keeps the 40px touch target in both states', () => {
    expect(filterChipClasses(true)).toContain('min-h-[40px]');
    expect(filterChipClasses(false)).toContain('min-h-[40px]');
  });

  it('uses only semantic tokens — no raw Tailwind palette colour', () => {
    // Nothing in the gate chain catches `bg-red-50` in a web-admin component,
    // so this assertion is the guard.
    const palette =
      /\b(?:bg|text|border)-(?:slate|gray|zinc|stone|red|amber|green|blue|indigo)-\d{2,3}\b/;
    expect(filterChipClasses(true)).not.toMatch(palette);
    expect(filterChipClasses(false)).not.toMatch(palette);
  });
});
