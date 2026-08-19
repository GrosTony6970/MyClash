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

/**
 * This one spawns a second Node process and has it read all of
 * `node_modules/lucide-react`, so it is the only test here that does real I/O.
 * Alone it takes about a second; inside `turbo run test`, with every other
 * workspace's suite competing for the same disk, it has been measured at 11.5s
 * and blew the 5s default — a red that reads exactly like icon drift and is
 * nothing of the kind. Generous rather than tight on purpose: the cost of a
 * false red here is a wasted drift investigation, and the bound is still low
 * enough that a genuinely hung generator fails instead of stalling CI.
 */
const GENERATOR_CHECK_TIMEOUT_MS = 60_000;

describe('vendored nav icons', () => {
  it(
    'matches the lucide-react version installed',
    () => {
      // Throws with the generator's own message (and the fix command) on drift.
      expect(() =>
        execFileSync(process.execPath, [GENERATOR, '--check'], { encoding: 'utf8', stdio: 'pipe' }),
      ).not.toThrow();
    },
    GENERATOR_CHECK_TIMEOUT_MS,
  );

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
