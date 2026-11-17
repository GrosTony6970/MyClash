import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A status ink reads on its own wash up to 15% (known-deviations D34, D37). The scoring app put
 * its buttons and alerts on 20% and 25% washes: 3.85 to 4.23:1 on light and 4.14 to 4.18:1 in the
 * dark dialogs (D41). This scans the app for a status wash above 15% behind text; a `hover:` or
 * `active:` wash is a moment, not a resting state, and is let through.
 */
const ROOT = join(__dirname, '..');
const HEAVY_WASH = /(?<![\w:/-])bg-(?:danger|warning|info|success)\/(?:[2-9]\d)(?![\w-])/g;

function* sources(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* sources(path);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) yield path;
  }
}

describe('the status washes of the scoring app', () => {
  it('stay at 15% or under at rest', () => {
    const found: string[] = [];
    for (const dir of ['app', 'src']) {
      for (const file of sources(join(ROOT, dir))) {
        readFileSync(file, 'utf8')
          .split('\n')
          .forEach((line, i) => {
            if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
            for (const [cls] of line.matchAll(HEAVY_WASH)) {
              found.push(`${relative(ROOT, file).replaceAll('\\', '/')}:${i + 1} ${cls}`);
            }
          });
      }
    }
    expect(found).toEqual([]);
  });
});
