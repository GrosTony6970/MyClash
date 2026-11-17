import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * "Swap sides" and "Fullscreen" float over the top-left corner of the projector popup, which is
 * the scoreboard's WHITE header. They were 70% white on a 40% black wash: 2.2:1 over that header
 * (known-deviations D27). They now paint a fill of their own in the stage's colour and write the
 * stage ink. `packages/ui/src/theme-ink-contrast.test.ts` measures that pair.
 *
 * The page needs a bout to render, so the source is read as text.
 */
describe('the toggles of the projector popup', () => {
  const source = readFileSync(join(__dirname, 'page.tsx'), 'utf8');
  const toggle = /const STAGE_TOGGLE =\s*'([^']*)'/.exec(source)?.[1]?.split(' ') ?? [];

  it('paint their own fill and write the stage ink on it', () => {
    expect(toggle).toContain('bg-stage/80');
    expect(toggle).toContain('text-stage-foreground');
  });

  it('spend no raw white or black', () => {
    expect(toggle.filter((c) => /(^|:)(bg|text|border)-(white|black)(\/|$)/.test(c))).toEqual([]);
  });
});
