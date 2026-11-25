import { describe, expect, it } from 'vitest';
import {
  mergeScores,
  type MatchScoreUpdate,
  type MergeableMatch,
  type MergeablePool,
} from './match-scores-merge';

// Test fixture type — adds the pass-through `lice_id` field so we can
// verify it survives a score merge. The helper is generic so callers
// can mix in any extra fields.
interface FixtureMatch extends MergeableMatch {
  lice_id?: string | null;
}

function pool(matches: FixtureMatch[]): MergeablePool<FixtureMatch> {
  return { poolId: 'pool-1', poolName: 'Pool 1', matches };
}

/**
 * One row of `GET tournaments/:id/match-scores`, with exactly the keys the API maps
 * (`PhasesService.listMatchScores`, apps/api/src/modules/phases/phases.service.ts: its select
 * `id, status, red_score, blue_score, winner_registration_id, winner_team_id,
 * phases!inner(tournament_id)`, the `phases` embed left out of the answer).
 *
 * This key list is a hand copy: no typed client covers the route, so nothing ties it to the API.
 * A column added to or dropped from that select must be mirrored here and in `MatchScoreUpdate`.
 */
function scoreRow(over: Partial<MatchScoreUpdate> & { id: string }): MatchScoreUpdate {
  return {
    status: 'pending',
    red_score: null,
    blue_score: null,
    winner_registration_id: null,
    winner_team_id: null,
    ...over,
  };
}

/** A row of the Matches tab with the same fields, as the tab holds it before a poll. */
function tabRow(over: Partial<FixtureMatch> & { id: string }): FixtureMatch {
  return { ...scoreRow({ id: over.id }), ...over };
}

describe('mergeScores', () => {
  it('feeds the exact row the API answers', () => {
    expect(Object.keys(scoreRow({ id: 'm-1' })).sort()).toEqual(
      [
        'id',
        'status',
        'red_score',
        'blue_score',
        'winner_registration_id',
        'winner_team_id',
      ].sort(),
    );
  });

  it('rewrites a row whose score changed', () => {
    const pools = [pool([tabRow({ id: 'm-1', lice_id: 'lice-a' })])];

    const merged = mergeScores(pools, [
      scoreRow({ id: 'm-1', status: 'completed', red_score: 5, blue_score: 3 }),
    ]);

    expect(merged[0]!.matches[0]).toMatchObject({
      id: 'm-1',
      status: 'completed',
      red_score: 5,
      blue_score: 3,
      winner_registration_id: null,
      // unrelated fields pass through unchanged
      lice_id: 'lice-a',
    });
  });

  it('takes the team winner a poll brings, the team behind on points after a forfeit', () => {
    const before = tabRow({ id: 'm-1', status: 'completed', red_score: 5, blue_score: 3 });
    const merged = mergeScores(
      [pool([before])],
      [
        scoreRow({
          id: 'm-1',
          status: 'completed',
          red_score: 5,
          blue_score: 3,
          winner_team_id: 'team-blue',
        }),
      ],
    );
    expect(merged[0]!.matches[0]).not.toBe(before);
    expect(merged[0]!.matches[0]!.winner_team_id).toBe('team-blue');
  });

  it('preserves object identity on rows whose score did not change', () => {
    // This is the property that lets React's reconciler skip the row,
    // which is what keeps open <select> dropdowns open across a poll.
    const unchanged = tabRow({
      id: 'm-1',
      status: 'completed',
      red_score: 5,
      blue_score: 3,
      winner_team_id: 'team-red',
      lice_id: 'lice-a',
    });
    const pools = [pool([unchanged])];

    const merged = mergeScores(pools, [
      scoreRow({
        id: 'm-1',
        status: 'completed',
        red_score: 5,
        blue_score: 3,
        winner_team_id: 'team-red',
      }),
    ]);

    expect(merged[0]!.matches[0]).toBe(unchanged); // identity, not equality
    expect(merged[0]).toBe(pools[0]); // pool identity also preserved
  });

  it('ignores updates whose id is not in the pool', () => {
    const original = pool([tabRow({ id: 'm-1' })]);
    const merged = mergeScores(
      [original],
      [scoreRow({ id: 'm-ghost', status: 'completed', red_score: 5, blue_score: 3 })],
    );
    expect(merged[0]).toBe(original); // no mutation, same reference
  });

  it('returns the original array when there are no updates', () => {
    const pools = [pool([])];
    expect(mergeScores(pools, [])).toBe(pools);
  });

  it('handles a mix of changed and unchanged rows in the same pool', () => {
    const stableRow = tabRow({ id: 'm-1' });
    const changingRow = tabRow({ id: 'm-2' });
    const pools = [pool([stableRow, changingRow])];

    const merged = mergeScores(pools, [
      scoreRow({ id: 'm-1' }),
      scoreRow({ id: 'm-2', status: 'completed', red_score: 5, blue_score: 3 }),
    ]);

    // Stable row keeps identity; changing row is rewritten.
    expect(merged[0]!.matches[0]).toBe(stableRow);
    expect(merged[0]!.matches[1]).not.toBe(changingRow);
    expect(merged[0]!.matches[1]!.status).toBe('completed');
  });
});
