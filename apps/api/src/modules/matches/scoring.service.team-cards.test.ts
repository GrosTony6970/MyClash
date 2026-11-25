import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSupabase, selectsFor } from '../../common/testing/supabase-chain';
import { ClockService } from './clock.service';
import { NOW, RUNNING } from './clock-late-press.fixtures';
import { BLUE_LEADS, STAFF, boutRow } from './round-end.fixtures';
import { BOUT, hit, setup, storedBout } from './scoring.service.corrections.fixtures';
import { ScoringService } from './scoring.service';
import { builtInResolver } from './built-in-resolver.fixtures';

/**
 * A card on a team bout names a team (ADR-022, call 5): its Registration column is null. The score
 * places it by side key, so it costs the team it names, and only that team. Placed by
 * Registration, it cost nobody: null is no side of the bout.
 */

const TEAMS = {
  red_registration_id: null,
  blue_registration_id: null,
  red_team_id: 'team-red',
  blue_team_id: 'team-blue',
};

/** A live card that costs `delta`, on the team `teamId`. */
const teamCard = (teamId: string, delta: number) => ({
  id: `card-${teamId}`,
  match_id: BOUT,
  registration_id: null,
  team_id: teamId,
  score_delta: delta,
  round_number: 1,
  voided: false,
});

describe('a card on a team bout costs the team it names', () => {
  it('a single fight: the red team loses its point, the blue team keeps its score', async () => {
    const bout = storedBout({ ...TEAMS, winner_registration_id: null, winner_team_id: 'team-red' });
    const sheet = [hit(1, 'red', 3), hit(2, 'red', 2), hit(3, 'blue', 3)];
    const { db, service } = setup(bout, sheet, undefined, [teamCard('team-red', -1)]);

    await expect(service.recomputeMatchScore(BOUT)).resolves.toEqual({
      redScore: 4,
      blueScore: 3,
    });
    expect(selectsFor(db.from, 'match_penalties')).toEqual([
      'id, score_delta, registration_id, team_id, round_number',
    ]);
  });
});

describe('a card on a team bout costs its team in a round too', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date(NOW) });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('round 1 closes with the red team a point down', async () => {
    const db = mockSupabase({
      matches: { rows: [boutRow(TEAMS, 'running')] },
      exchanges: { rows: BLUE_LEADS },
      match_penalties: { rows: [teamCard('team-red', -1)] },
      match_events: { rows: [...RUNNING] },
    });
    const scoring = new ScoringService(
      db as never,
      builtInResolver(),
      new ClockService(db as never),
    );

    await expect(scoring.endRoundOnTime(BOUT, STAFF)).resolves.toEqual({
      redScore: 0,
      blueScore: 2,
    });
    expect(selectsFor(db.from, 'match_penalties')).toEqual([
      'score_delta, registration_id, team_id, round_number',
    ]);
  });
});
