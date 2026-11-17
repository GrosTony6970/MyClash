import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Text drawn in a hue that does not read on the light page (known-deviations D30), measured on
 * 2026-11-17:
 *
 * - the afterblow columns of a Tournament's stats, orange-600 and red-400: 3.43:1 and 2.77:1;
 * - the label of a break bar on the Tournament schedule grid, in the bar's own colour: a
 *   workshop's amber was 2.15:1;
 * - the time of a programme bar on `/me`'s schedule, in the bar's colour on a wash of itself:
 *   1.87:1.
 *
 * The bar keeps its colour on its edge; its words take the page ink. The sources are read as text.
 */
const read = (...path: string[]) => readFileSync(join(__dirname, ...path), 'utf8');

describe("a Tournament's stats", () => {
  const source = read('t', '[tournamentSlug]', 'StatsView.tsx');

  it('writes each blow column in an ink that reads', () => {
    expect(source).toContain("afterblowGiven: 'text-orange-700'");
    expect(source).toContain("hitsReceived: 'text-red-800'");
    expect(source).toContain("afterblowReceived: 'text-red-700'");
  });

  it('writes no orange-600 or red-400', () => {
    expect(source).not.toMatch(/text-orange-600|text-red-400/);
  });
});

describe('the break bar of the Tournament schedule grid', () => {
  const source = read('schedule', 'tournaments', '_components', 'TournamentScheduleGrid.tsx');

  it('writes its label in the page ink and keeps the colour on its edge', () => {
    expect(source).not.toContain('color: accent,');
    expect(source).toContain('borderColor: accent');
  });
});

describe("the programme bar of /me's schedule", () => {
  const source = read('..', '..', '..', 'src', 'components', 'me', 'ScheduleView.tsx');

  it('writes its time in the page ink, not the bar colour', () => {
    expect(source).not.toContain('style={{ color: tint.borderColor }}');
    expect(source).toContain('font-bold tabular-nums text-foreground-secondary');
  });
});
