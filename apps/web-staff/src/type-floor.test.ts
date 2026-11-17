import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * No text under 10px (known-deviations D33, D41). In the scoring app the clock's centiseconds were
 * half the size of their line, 6px on the 12px "total time" line; they are `max(0.5em, 10px)`.
 * This scans the whole app, so a new size under the floor goes red here. web-public, web-admin and
 * `packages/ui` hold the same scan over their own files.
 */
const ROOT = join(__dirname, '..');
const FLOOR_PX = 10;
const ARBITRARY_SIZE = /(?<![\w-])text-\[(\d*\.?\d+)(px|rem)\]/g;

function* sources(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* sources(path);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) yield path;
  }
}

describe('the type floor of the scoring app', () => {
  it(`sets no text under ${FLOOR_PX}px`, () => {
    const found: string[] = [];
    for (const dir of ['app', 'src']) {
      for (const file of sources(join(ROOT, dir))) {
        readFileSync(file, 'utf8')
          .split('\n')
          .forEach((line, i) => {
            for (const [cls, value, unit] of line.matchAll(ARBITRARY_SIZE)) {
              const px = Number(value) * (unit === 'rem' ? 16 : 1);
              if (px < FLOOR_PX) {
                found.push(`${relative(ROOT, file).replaceAll('\\', '/')}:${i + 1} ${cls}`);
              }
            }
          });
      }
    }
    expect(found).toEqual([]);
  });
});
