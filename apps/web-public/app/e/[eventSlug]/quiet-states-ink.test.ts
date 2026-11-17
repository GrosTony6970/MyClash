import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Quiet by colour, not by fade (known-deviations D29). Two places of the public Event pages set
 * text back with an opacity, and took it under the reading bar:
 *
 * - the sub-lines of a Tournament block on the schedule grid, at 70% and 80% of the tint ink;
 * - the loser's score on a bout page, the side colour at 40% (1.8:1 to 2.6:1). It is the muted
 *   ink now, and the winner keeps the side colour.
 *
 * Both need an Event's data to render, so the sources are read as text.
 */
const read = (...path: string[]) => readFileSync(join(__dirname, ...path), 'utf8');
const FADE = /(?<![\w:-])opacity-[4-9]0(?![\w-])/g;

describe('the Tournament schedule grid', () => {
  it('fades no line of a block', () => {
    const source = read('schedule', 'tournaments', '_components', 'TournamentScheduleGrid.tsx');
    expect(source.match(FADE) ?? []).toEqual([]);
  });
});

describe("the bout page's score", () => {
  const source = read('match', '[matchId]', 'match-live-view.tsx');

  it("writes the loser's score in the muted ink, not the side colour faded", () => {
    expect(source).toContain("'text-muted'");
    expect(source.match(FADE) ?? []).toEqual([]);
  });
});
