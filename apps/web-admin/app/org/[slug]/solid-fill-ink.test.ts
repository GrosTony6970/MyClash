import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Two fills of the organiser's console take a colour the organiser picked and carry words: the
 * strip above each run of the detailed schedule (the Tournament's colour) and the "Live" pill of
 * the brand preview (the organisation's hex). Both wrote a fixed white, which cannot be read on a
 * white, silver, yellow or gold Tournament, or on a light brand colour (known-deviations D26).
 *
 * Each needs the board's or the dashboard's data to render, so the sources are read as text.
 * `packages/ui` measures the inks: `theme-ink-contrast.test.ts` and `side-color.test.ts`.
 */
const read = (...path: string[]) => readFileSync(join(__dirname, ...path), 'utf8');

describe('the run header of the detailed schedule', () => {
  const source = read('events', '[eventId]', 'schedule', 'DetailedRunHeaders.tsx');

  it('takes the ink of the Tournament colour it is filled with', () => {
    expect(source).toContain('accentClassFor(group.tournamentColor)');
    expect(source).toContain('accentInkClassFor(group.tournamentColor)');
  });

  it('writes no fixed white', () => {
    expect(source).not.toContain('text-white');
  });
});

describe('the "Live" pill of the brand preview', () => {
  const source = read('page.tsx');

  it('computes its ink from the brand colour it is filled with', () => {
    expect(source).toContain('style={{ backgroundColor: accent, color: inkOnHex(accent) }}');
  });

  it('writes no fixed white', () => {
    expect(source).not.toContain('text-white');
  });
});
