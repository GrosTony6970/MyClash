import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A corner colour is never the ink of words on the pad (known-deviations D38). Names, round
 * tallies, scores on the piste list and the round's winner were written in the raw corner colour:
 * blue 2.83:1 and red 3.03:1 on the dark pad, a black or white corner 1.4:1. By the operator's
 * ruling the words take the page's ink and a `CornerDot` sits beside them.
 *
 * The inline inks that may follow a corner:
 * - the pad's big score numeral, large and clamped through `legibleOn` for the pad's scope;
 * - `style.text` / `otherStyle.text` / `.muted`, the panel's own ink on the panel's own fill
 *   (`SideColorStyle`);
 * - `outlineInkOn(style, padScope)`, the afterblow button's ink, measured in `side-color.test.ts`.
 *
 * This scans the whole app, so a new `color:` in a corner colour goes red here.
 */
const ROOT = join(__dirname, '..');
const INLINE_INK = /(?<![\w-])color:\s*([^}\n]+)/g;
const ALLOWED = [
  "reachedCap ? 'var(--color-gold)' : legibleOn(style.border, padScope)",
  'style.text',
  'otherStyle.text',
  'otherStyle.muted',
  'outlineInkOn(style, padScope)',
];

function* sources(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* sources(path);
    else if (/\.tsx$/.test(name) && !/\.test\.tsx$/.test(name)) yield path;
  }
}

describe("the scoring app's inline inks", () => {
  it('never writes words in a raw corner colour', () => {
    const found: string[] = [];
    for (const dir of ['app', 'src']) {
      for (const file of sources(join(ROOT, dir))) {
        readFileSync(file, 'utf8')
          .split('\n')
          .forEach((line, i) => {
            if (!line.includes('style=') && !/^\s+color:/.test(line)) return;
            for (const [, value] of line.matchAll(INLINE_INK)) {
              const v = (value ?? '').trim().replace(/,$/, '');
              // A type field (`color: string;`), not a style.
              if (v.endsWith(';')) continue;
              if (
                ALLOWED.some((ok) => v === ok || v.startsWith(`${ok},`) || v.startsWith(`${ok} `))
              )
                continue;
              found.push(`${relative(ROOT, file).replaceAll('\\', '/')}:${i + 1} color: ${v}`);
            }
          });
      }
    }
    expect(found).toEqual([]);
  });
});
