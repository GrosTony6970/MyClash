/**
 * The piste's Pool list bolds the recorded winner (`poolRowWinner`).
 *
 * Paris Rapiers lead Lyon Blades 5 - 2 when Paris withdraw: Lyon win by forfeit on the lower
 * score. The list bolds Lyon, as the organiser's Matches tab does, and never the side with more
 * points because a team has no Registration.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PoolMatchRow } from '../components/tournament-context-types';
import { poolRowWinner } from './pool-row-winner';

const ROW: PoolMatchRow = {
  id: 'm1',
  lice_id: 'lice-1',
  lice_name: 'Piste 1',
  lice_number: 1,
  red_name: 'Lyon Blades',
  blue_name: 'Paris Rapiers',
  red_club_abbrev: null,
  blue_club_abbrev: null,
  red_score: 2,
  blue_score: 5,
  winner_registration_id: null,
  winner_team_id: 'team-lyon',
  red_registration_id: null,
  blue_registration_id: null,
  red_team_id: 'team-lyon',
  blue_team_id: 'team-paris',
  red_team_color: 'green',
  blue_team_color: 'purple',
  status: 'completed',
  match_number_label: 'L1-P1-M1',
  roundCode: 'L1-P1-M1',
};

describe('poolRowWinner', () => {
  it('bolds the team that won by forfeit on the lower score', () => {
    expect(poolRowWinner(ROW)).toBe('red');
  });

  it('bolds the recorded Fighter of an individual bout', () => {
    const fighters = {
      ...ROW,
      red_team_id: null,
      blue_team_id: null,
      winner_team_id: null,
      red_registration_id: 'reg-anna',
      blue_registration_id: 'reg-ben',
      winner_registration_id: 'reg-ben',
      red_score: 5,
      blue_score: 2,
    };
    expect(poolRowWinner(fighters)).toBe('blue');
  });

  it('bolds nobody on a bout not played', () => {
    expect(poolRowWinner({ ...ROW, status: 'scheduled', winner_team_id: null })).toBeNull();
  });
});

describe('the list', () => {
  // web-staff has no React test setup: the screen is read as text.
  const list = readFileSync(
    join(__dirname, '..', '..', 'app', 'lices', '[liceId]', '_components', 'PoolMatchList.tsx'),
    'utf8',
  );

  it('bolds by the recorded winner, and shows a team’s colour chip beside its name', () => {
    expect(list).toContain('const winner = poolRowWinner(match);');
    expect(list).toContain('<TournamentColorDot color={teamColour} size="md" />');
    expect(list).toContain('teamColour={match.red_team_color}');
    expect(list).toContain('teamColour={match.blue_team_color}');
  });
});
