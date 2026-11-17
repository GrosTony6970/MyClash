import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The muted ink on a grey chip of its own: `text-muted` on `bg-border`, `bg-foreground/10` or
 * `bg-muted/10`-`/15`. Measured on 2026-11-17, 3.79:1 to 3.95:1 (known-deviations D31): the
 * "disabled" freshness chip and a club's member count in the club picker. The secondary ink reads
 * on all of them, 6.04:1 at least. Each app holds the same scan over its own files.
 */
const ROOT = __dirname;
const GREY_FILL = /(?<![\w:/-])(?:bg-border|bg-foreground\/10|bg-muted\/1[05])(?![\w/-])/;
const MUTED = /(?<![\w:-])text-muted(?![\w/-])/;
const STRING = /(["'`])((?:(?!\1).)*)\1/g;

function* sources(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* sources(path);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) yield path;
  }
}

describe('a grey chip of the shared components', () => {
  it('writes the secondary ink, not the muted one', () => {
    const found: string[] = [];
    for (const file of sources(ROOT)) {
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
    expect(found).toEqual([]);
  });
});

/**
 * A Tournament's colour dot. A white, silver, yellow or gold dot was 1.1:1 to 1.7:1 against a white
 * card and showed no shape; an inset ring of the page ink at 50% gives every colour an edge.
 */
describe('the Tournament colour dot', () => {
  it('draws an inset ring', () => {
    expect(readFileSync(join(ROOT, 'TournamentColorDot.tsx'), 'utf8')).toContain(
      'rounded-full ring-1 ring-inset ring-foreground/50',
    );
  });
});
