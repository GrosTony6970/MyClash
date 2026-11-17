import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The muted ink on a grey chip of its own: `text-muted` on `bg-border`, `bg-foreground/10` or
 * `bg-muted/10`-`/15`. Measured on 2026-11-17, 3.79:1 to 3.95:1 (known-deviations D31): the step
 * circles of the Event wizard and the import, the "no venue" band of the schedule, the weapon
 * and clock-report chips. The secondary ink reads on all of them, 6.04:1 at least.
 *
 * This scans the whole app, so a new chip of that shape goes red here. A class string that also
 * says `cursor-not-allowed` is a disabled stand-in, which may be faint. web-public and
 * `packages/ui` hold the same scan over their own files.
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

describe("a grey chip of the organiser's console", () => {
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

/**
 * Three more small inks of the console (known-deviations D31): the "+R" button of the penalty
 * editor, white on red-500 (3.81:1); and the two "LIVE" badges of the dark sidebar, on a 30% red
 * wash (3.95:1 and, on the selected row of the Event switcher, 3.71:1).
 */
describe('the "+R" button and the sidebar LIVE badges', () => {
  const read = (...p: string[]) => readFileSync(join(ROOT, 'src', 'components', ...p), 'utf8');

  it('fills "+R" with red-700 under white', () => {
    expect(read('rulesets', 'PenaltyEntriesEditor.tsx')).toContain(
      "active: 'bg-red-700 text-white ring-red-800'",
    );
  });

  it('puts both LIVE badges on the lighter red wash', () => {
    const shell = read('OrganizerAdminShell.tsx');
    expect(shell).not.toContain('bg-danger/30');
    expect(shell.match(/rounded bg-danger\/15 px-1 py-px text-\[10px\] font-bold/g)).toHaveLength(
      2,
    );
  });
});
