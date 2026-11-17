import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The muted ink on a grey chip of its own: `text-muted` on `bg-border`, `bg-foreground/10` or
 * `bg-muted/10`-`/15`. Measured on 2026-11-17, 3.79:1 to 3.95:1 (known-deviations D31): "Paused",
 * "pending", "lost", "draw", notifications "Off", a Workshop's language tag. The secondary ink
 * reads on all of them, 6.04:1 at least.
 *
 * This scans the whole app, so a new chip of that shape goes red here. A class string that also
 * says `cursor-not-allowed` is a disabled stand-in, which may be faint.
 */
const ROOT = join(__dirname, '..');
const GREY_FILL = /(?<![\w:/-])(?:bg-border|bg-foreground\/10|bg-muted\/1[05])(?![\w/-])/;
const MUTED = /(?<![\w:-])text-muted(?![\w/-])/;
const STRING = /(["'`])((?:(?!\1).)*)\1/g;

function* sources(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* sources(path);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) yield path;
  }
}

describe('a grey chip of the fighter app', () => {
  it('writes the secondary ink, not the muted one', () => {
    const found: string[] = [];
    for (const dir of ['app', 'src']) {
      for (const file of sources(join(ROOT, dir))) {
        readFileSync(file, 'utf8')
          .split('\n')
          .forEach((line, i) => {
            for (const [, , cls] of line.matchAll(STRING)) {
              if (!cls || !GREY_FILL.test(cls) || !MUTED.test(cls)) continue;
              if (cls.includes('cursor-not-allowed')) continue;
              found.push(`${relative(ROOT, file).replaceAll('\\', '/')}:${i + 1}`);
            }
          });
      }
    }
    expect(found).toEqual([]);
  });
});
