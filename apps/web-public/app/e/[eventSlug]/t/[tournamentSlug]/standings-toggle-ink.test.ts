import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The selected half of the "Overall / By pool" toggle is filled with the Tournament's colour. It
 * wrote a fixed white, so on a white, silver, yellow or gold Tournament the selected label could
 * not be read: 1.1:1 to 1.7:1 (known-deviations D26).
 *
 * The view fetches its standings, so the source is read as text.
 * `packages/ui/src/theme-ink-contrast.test.ts` measures every fill with its ink.
 */
describe('the selected Standings toggle', () => {
  const source = readFileSync(join(__dirname, 'StandingsView.tsx'), 'utf8');

  it('takes the ink of the Tournament colour it is filled with', () => {
    expect(source).toContain('`${accentClassFor(colorToken)} ${accentInkClassFor(colorToken)}`');
  });

  it('writes no fixed white', () => {
    expect(source).not.toContain('text-white');
  });
});
