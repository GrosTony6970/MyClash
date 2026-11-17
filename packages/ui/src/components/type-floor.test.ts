import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * No text under 10px in the shared components (known-deviations D33). The piste pill of a bracket
 * card was 9px; it is 10px, the size of the pills beside it. The stage sizes are `clamp()` values
 * on the stage type scale and are not arbitrary `text-[…]` classes, so this does not see them.
 */
const FLOOR_PX = 10;
const ARBITRARY_SIZE = /(?<![\w-])text-\[(\d*\.?\d+)(px|rem)\]/g;

function* sources(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* sources(path);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) yield path;
  }
}

describe('the type floor of the shared components', () => {
  it(`sets no text under ${FLOOR_PX}px`, () => {
    const found: string[] = [];
    for (const file of sources(__dirname)) {
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          for (const [cls, value, unit] of line.matchAll(ARBITRARY_SIZE)) {
            const px = Number(value) * (unit === 'rem' ? 16 : 1);
            if (px < FLOOR_PX) {
              found.push(`${relative(__dirname, file).replaceAll('\\', '/')}:${i + 1} ${cls}`);
            }
          }
        });
    }
    expect(found).toEqual([]);
  });
});
