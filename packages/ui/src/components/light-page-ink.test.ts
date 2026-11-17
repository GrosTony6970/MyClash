import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Two shared components wrote `text-slate-400` on a white card: the ⓘ glyph of every help tooltip
 * in the organiser's console, and the italic "TBD" of an empty podium place. Measured on
 * 2026-11-17, 2.63:1 (known-deviations D30). The glyph takes the muted ink, the podium slate-500,
 * both 4.76:1.
 */
const read = (...path: string[]) => readFileSync(join(__dirname, ...path), 'utf8');

describe('grey ink on a white card', () => {
  it('the help glyph reads in the muted ink and darkens on hover', () => {
    const source = read('HelpTooltip.tsx');
    expect(source).toContain('text-muted hover:text-foreground');
    expect(source).not.toMatch(/(?<![\w-])text-slate-400(?![\w-])/);
  });

  it('an empty podium place reads its "TBD" in slate-500', () => {
    const source = read('bracket', 'MedalPodium.tsx');
    expect(source.match(/isTbd \? 'italic text-slate-500'/g) ?? []).toHaveLength(2);
    expect(source).not.toContain("'italic text-slate-400'");
  });
});
