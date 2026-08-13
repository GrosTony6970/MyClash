import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { LUCIDE_GLYPHS } from './nav-icon-glyphs';
import { NAV_ICON_GLYPHS, NAV_ICON_NAMES } from './NavIcon';

/**
 * `nav-icon-glyphs.ts` is vendored path data. Vendored artwork rots quietly:
 * lucide redraws icons between minor versions, and a copy taken once would
 * simply stop matching upstream with nothing to say so.
 *
 * So the generator is the assertion. `--check` regenerates from
 * `node_modules/lucide-react` and compares against the committed file, which
 * means an upgrade that changes a path fails here and the fix is re-running the
 * same script.
 */
const GENERATOR = join(__dirname, '..', '..', 'scripts', 'generate-nav-icons.mjs');

describe('vendored nav icons', () => {
  it('matches the lucide-react version installed', () => {
    // Throws with the generator's own message (and the fix command) on drift.
    expect(() =>
      execFileSync(process.execPath, [GENERATOR, '--check'], { encoding: 'utf8', stdio: 'pipe' }),
    ).not.toThrow();
  });

  /**
   * The generator reads the glyph list out of NavIcon.tsx with a regex. These
   * two are what make that safe: a misread shows up as a missing or an extra
   * glyph rather than as a blank square in a sidebar.
   */
  it('vendors a glyph for every slug the sidebars declare', () => {
    const missing = NAV_ICON_NAMES.filter((name) => !(NAV_ICON_GLYPHS[name] in LUCIDE_GLYPHS));
    expect(missing).toEqual([]);
  });

  it('vendors nothing the sidebars do not use', () => {
    const used = new Set<string>(NAV_ICON_NAMES.map((name) => NAV_ICON_GLYPHS[name]));
    const dead = Object.keys(LUCIDE_GLYPHS).filter((glyph) => !used.has(glyph));
    // Dead path data is the whole failure this package just stopped paying for
    // at 188 KB gzip; 200 bytes of it is still 200 bytes nobody renders.
    expect(dead).toEqual([]);
  });

  // There is deliberately no "every glyph has at least one node" assertion:
  // `as const` makes each array's length a literal type, so tsc rejects the
  // comparison as unsatisfiable. The type already carries that guarantee, and a
  // test that cannot fail reads like coverage while proving nothing.
});
