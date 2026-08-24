import { describe, expect, it } from 'vitest';
import type { LeagueTieBreaker } from './league-types';
import { attachDecidingTiebreaks, decidingTiebreakBetween } from './league-standings-rows';

const DEFAULT_TIEBREAKERS: LeagueTieBreaker[] = [
  'total_points',
  'participation_count',
  'medal_count',
  'double_hit_average',
];

function row(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    ranking_group_key: 'longsword',
    total_points: 0,
    participation_count: 0,
    medal_count: 0,
    double_hit_average: '0',
    ...overrides,
  };
}

describe('decidingTiebreakBetween', () => {
  it('reports total_points (desc) when points differ', () => {
    const above = row({ total_points: 30 });
    const me = row({ total_points: 24 });
    expect(decidingTiebreakBetween(above, me, DEFAULT_TIEBREAKERS)).toEqual({
      key: 'total_points',
      direction: 'desc',
      mine: 24,
      theirs: 30,
    });
  });

  it('skips equal keys and reports participation_count when it is the first to differ', () => {
    const above = row({ total_points: 20, participation_count: 4 });
    const me = row({ total_points: 20, participation_count: 3 });
    expect(decidingTiebreakBetween(above, me, DEFAULT_TIEBREAKERS)).toEqual({
      key: 'participation_count',
      direction: 'desc',
      mine: 3,
      theirs: 4,
    });
  });

  it('reports medal_count when points + participations tie', () => {
    const above = row({ total_points: 20, participation_count: 3, medal_count: 2 });
    const me = row({ total_points: 20, participation_count: 3, medal_count: 1 });
    expect(decidingTiebreakBetween(above, me, DEFAULT_TIEBREAKERS)).toEqual({
      key: 'medal_count',
      direction: 'desc',
      mine: 1,
      theirs: 2,
    });
  });

  it('reports double_hit_average as asc (lower is better) and parses the numeric string', () => {
    const above = row({
      total_points: 20,
      participation_count: 3,
      medal_count: 1,
      double_hit_average: '1.25',
    });
    const me = row({
      total_points: 20,
      participation_count: 3,
      medal_count: 1,
      double_hit_average: '2.50',
    });
    expect(decidingTiebreakBetween(above, me, DEFAULT_TIEBREAKERS)).toEqual({
      key: 'double_hit_average',
      direction: 'asc',
      mine: 2.5,
      theirs: 1.25,
    });
  });

  it('returns null when the two rows tie on every configured key', () => {
    const above = row({
      total_points: 20,
      participation_count: 3,
      medal_count: 1,
      double_hit_average: '1.5',
    });
    const me = row({
      total_points: 20,
      participation_count: 3,
      medal_count: 1,
      double_hit_average: '1.5',
    });
    expect(decidingTiebreakBetween(above, me, DEFAULT_TIEBREAKERS)).toBeNull();
  });

  it('honours the configured tie-breaker order (only walks the keys it is given)', () => {
    // Points differ, but the config does not include total_points, so the walk
    // falls through to medal_count.
    const above = row({ total_points: 30, medal_count: 3 });
    const me = row({ total_points: 24, medal_count: 1 });
    expect(decidingTiebreakBetween(above, me, ['medal_count'])).toEqual({
      key: 'medal_count',
      direction: 'desc',
      mine: 1,
      theirs: 3,
    });
  });
});

describe('attachDecidingTiebreaks', () => {
  it('gives the group leader a null tie-break and derives the rest against the row above', () => {
    const rows = [
      row({ rank: 1, total_points: 30 }),
      row({ rank: 2, total_points: 24 }),
      row({ rank: 3, total_points: 24, participation_count: 2 }),
    ];
    // row-3 shares points with row-2 but has fewer participations → row-2 seeds 3 here.
    rows[1]!['participation_count'] = 3;
    const out = attachDecidingTiebreaks(rows, DEFAULT_TIEBREAKERS);
    expect(out[0]!.decidingTiebreak).toBeNull();
    expect(out[1]!.decidingTiebreak).toEqual({
      key: 'total_points',
      direction: 'desc',
      mine: 24,
      theirs: 30,
    });
    expect(out[2]!.decidingTiebreak).toEqual({
      key: 'participation_count',
      direction: 'desc',
      mine: 2,
      theirs: 3,
    });
  });

  it('resets at group boundaries — the first row of every group gets null', () => {
    const rows = [
      row({ ranking_group_key: 'longsword', rank: 1, total_points: 30 }),
      row({ ranking_group_key: 'longsword', rank: 2, total_points: 20 }),
      // New group: even though the previous row has more points, this is a
      // different ranking group so there is no fighter above it.
      row({ ranking_group_key: 'rapier', rank: 1, total_points: 10 }),
      row({ ranking_group_key: 'rapier', rank: 2, total_points: 5 }),
    ];
    const out = attachDecidingTiebreaks(rows, DEFAULT_TIEBREAKERS);
    expect(out[0]!.decidingTiebreak).toBeNull();
    expect(out[1]!.decidingTiebreak).toMatchObject({ key: 'total_points', mine: 20, theirs: 30 });
    expect(out[2]!.decidingTiebreak).toBeNull();
    expect(out[3]!.decidingTiebreak).toMatchObject({ key: 'total_points', mine: 5, theirs: 10 });
  });

  it('preserves the original row fields alongside the derived tie-break', () => {
    const rows = [row({ rank: 1, global_person_id: 'gp-1', total_points: 15 })];
    const [only] = attachDecidingTiebreaks(rows, DEFAULT_TIEBREAKERS);
    expect(only).toMatchObject({
      global_person_id: 'gp-1',
      total_points: 15,
      decidingTiebreak: null,
    });
  });
});
