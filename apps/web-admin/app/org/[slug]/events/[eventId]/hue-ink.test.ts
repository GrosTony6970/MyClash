import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Two inks of an Event's pages in the organiser's console that did not read (known-deviations
 * D30), measured on 2026-11-17:
 *
 * - the date of the archived-Event banner, yellow-600 on yellow-50: 2.84:1. It takes the ink of the
 *   sentence beside it, yellow-800, 6.61:1;
 * - the colour swatch of each referee skill painted the pale tint, 1.09:1 on white: every skill
 *   showed an empty ring. It paints the skill's colour, inside a hairline dark enough to show the
 *   shape of a light colour.
 *
 * The sources are read as text.
 */
const read = (...path: string[]) => readFileSync(join(__dirname, ...path), 'utf8');

describe('the archived-Event banner', () => {
  it('writes its date in the ink of its sentence', () => {
    const source = read('_components', 'ArchivedBanner.tsx');
    expect(source).not.toContain('text-yellow-600');
    expect(source).toContain('ml-2 text-yellow-800 text-xs');
  });
});

describe('the referee skill swatch', () => {
  const source = read('referees', '_components', 'SkillCatalog.tsx');

  it("paints the skill's colour, not its tint", () => {
    expect(source).toContain('accentClassFor(skill.color)');
    expect(source).not.toContain('tintBgClassFor');
  });

  it('draws a hairline that shows the shape of a light colour', () => {
    expect(source).toContain('rounded-full border border-foreground/50');
  });
});
