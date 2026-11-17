import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The accent is a fill, never an outline, a ring or an ink, in the scoring app (known-deviations
 * D39). No scope lightens the accent, so in the all-dark mode a red outline or focus ring was 2.3
 * to 2.8:1 on the page: the live bout card, "your pool", the selected event at login, and the focus
 * of every field. By the operator's ruling they take `gold-text`: deep amber on light (6.8:1), bright
 * gold on dark (10.7:1), as the buttons' focus ring does (D32).
 *
 * `bg-accent` with its `text-accent-foreground`, and an accent wash behind other ink, stay allowed.
 * This scans the whole app.
 */
const ROOT = join(__dirname, '..');
const ACCENT_LINE =
  /(?<![\w-])(?:[a-z-]+:)*(?:ring|border|outline|text)-accent(?![\w-])(?:\/\d+)?/g;

function* sources(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* sources(path);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) yield path;
  }
}

describe('the accent in the scoring app', () => {
  it('is never an outline, a ring or an ink', () => {
    const found: string[] = [];
    for (const dir of ['app', 'src']) {
      for (const file of sources(join(ROOT, dir))) {
        readFileSync(file, 'utf8')
          .split('\n')
          .forEach((line, i) => {
            for (const [cls] of line.matchAll(ACCENT_LINE)) {
              found.push(`${relative(ROOT, file).replaceAll('\\', '/')}:${i + 1} ${cls}`);
            }
          });
      }
    }
    expect(found).toEqual([]);
  });
});
