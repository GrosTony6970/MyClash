import { describe, expect, it } from 'vitest';
import { DEFAULT_SCORING_CONFIG } from '@myclash/types';
import { buildUnifiedTimeline, isRowOfSide, rowSide } from './exchange-timeline';
import type { MatchProtest, Penalty } from '../types/match-events';

/**
 * A team bout: each side's key is its team, and a team card or protest names its team, with no
 * Registration. Before, such a row read no side by its Registration, and `null === null` put it
 * under both sides wherever a side had no Registration.
 */

const team = (id: string) => ({ registration_id: null, team_id: id });

describe('isRowOfSide', () => {
  it('matches a team card to its own team only, never a side with no key', () => {
    expect(isRowOfSide(team('team-red'), 'team-red')).toBe(true);
    expect(isRowOfSide(team('team-red'), 'team-blue')).toBe(false);
    expect(isRowOfSide(team('team-red'), null)).toBe(false);
    expect(isRowOfSide({ registration_id: null, team_id: null }, null)).toBe(false);
  });
});

describe('rowSide', () => {
  it('names the side whose team the row carries, by the bout side keys', () => {
    expect(rowSide(team('team-red'), 'team-red', 'team-blue')).toBe('red');
    expect(rowSide(team('team-blue'), 'team-red', 'team-blue')).toBe('blue');
    expect(rowSide(team('team-other'), 'team-red', 'team-blue')).toBeNull();
  });
});

describe('buildUnifiedTimeline on a team bout', () => {
  const card: Penalty = {
    id: 'p1',
    sequence: 1,
    ...team('team-blue'),
    card: 'yellow',
    source: 'direct',
    short_name: null,
    reason: 'leaves the piste',
    score_delta: 0,
    causes_match_forfeit: false,
    voided: false,
    occurred_at: '2027-06-21T10:01:00.000Z',
  };
  const protest: MatchProtest = {
    id: 'pr1',
    client_uuid: 'uuid-pr1',
    match_id: 'match-1',
    ...team('team-red'),
    sequence: 1,
    round_number: 1,
    clock_time_ms: 12_000,
    occurred_at: '2027-06-21T10:02:00.000Z',
    voided: false,
  };

  it('places a team card and a team protest on their own team side', () => {
    const out = buildUnifiedTimeline({
      exchanges: [],
      penalties: [card],
      protests: [protest],
      redName: 'Lyon Blades',
      blueName: 'Paris Rapiers',
      redSideId: 'team-red',
      blueSideId: 'team-blue',
      t: (k: string) => k,
      config: DEFAULT_SCORING_CONFIG,
    });

    const byRawId = new Map(out.map((e) => [e.rawId, e]));
    expect(byRawId.get('p1')).toMatchObject({ side: 'blue', fighterLabel: 'Paris Rapiers' });
    expect(byRawId.get('pr1')).toMatchObject({ side: 'red', fighterLabel: 'Lyon Blades' });
  });
});
