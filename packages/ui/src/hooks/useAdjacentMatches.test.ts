import { describe, expect, it } from 'vitest';
import { neighboursOf } from './useAdjacentMatches';

const tile = (id: string) => ({
  id,
  matchNumberLabel: null,
  roundCode: null,
  redName: 'Ana Red',
  blueName: 'Bo Blue',
  redClub: null,
  blueClub: null,
});

describe('neighboursOf', () => {
  it('shows nothing before the first read', () => {
    expect(neighboursOf(null, 'bout-1')).toEqual({ previous: null, next: null });
  });

  it('shows the neighbours last read for this bout', () => {
    const held = { matchId: 'bout-1', previous: tile('bout-0'), next: tile('bout-2') };

    expect(neighboursOf(held, 'bout-1')).toEqual({
      previous: tile('bout-0'),
      next: tile('bout-2'),
    });
  });

  it("never shows another bout's neighbours: its Next would be this bout", () => {
    const held = { matchId: 'bout-1', previous: tile('bout-0'), next: tile('bout-2') };

    expect(neighboursOf(held, 'bout-2')).toEqual({ previous: null, next: null });
  });

  it('shows nothing with no bout', () => {
    const held = { matchId: 'bout-1', previous: null, next: tile('bout-2') };

    expect(neighboursOf(held, null)).toEqual({ previous: null, next: null });
  });
});
