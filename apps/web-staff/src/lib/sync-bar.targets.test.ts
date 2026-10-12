/**
 * The sync bar's buttons are touch targets (quick win P11; operator,
 * 2026-10-12): the bar grows to 44px only when it has a button.
 *
 * The live size is held by `tests/a11y/pad-sync-bar-targets.spec.ts`. This pins
 * that every button of the bar takes the one target, so a fourth button cannot
 * be a 20px one.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const bar = readFileSync(join(__dirname, '..', 'components', 'SyncBar.tsx'), 'utf8');

describe('the buttons of the sync bar', () => {
  it('are 44px, and take back the padding of the bar', () => {
    expect(bar).toMatch(/const TARGET =\s+'-my-1 inline-flex min-h-\[44px\] min-w-\[44px\] /);
    expect(bar).toContain('const SOLID = `${TARGET} ');
    expect(bar).toContain('const OUTLINE = `${TARGET} ');
  });

  it('all take the target', () => {
    const buttons = bar.match(/<button[\s\S]*?<\/button>/g) ?? [];
    expect(buttons).toHaveLength(3);
    for (const button of buttons) {
      expect(button).toMatch(/className=\{(SOLID|OUTLINE|`\$\{OUTLINE\} disabled:opacity-50`)\}/);
    }
  });

  it('wrap under the sentence on a narrow tablet', () => {
    expect(bar).toContain(
      'className={`flex flex-wrap items-center justify-center gap-2 px-4 py-1 ',
    );
  });
});
