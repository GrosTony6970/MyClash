/**
 * Who the result screen crowns (`result-winner.ts`): the recorded winner, by side key.
 *
 * Paris Rapiers lead Lyon Blades 5 - 2 when Paris withdraw: Lyon win the Match by forfeit on the
 * lower score. The server records `winner_team_id` = Lyon. The screen crowns Lyon, never the side
 * with more points, and never nobody because a team has no Registration.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resultSides, resultWinner } from './result-winner';

const TEAM_BOUT = {
  redRegistrationId: null,
  blueRegistrationId: null,
  redTeamId: 'team-lyon',
  blueTeamId: 'team-paris',
  winnerRegistrationId: null,
  winnerTeamId: 'team-lyon',
};

const crowned = (sides: ReturnType<typeof resultSides>, red: number, blue: number) =>
  resultWinner({ resultReason: 'forfeit', ...sides, redScore: red, blueScore: blue });

describe('the result screen of a team Match', () => {
  it('crowns the team that won by forfeit on the lower score', () => {
    const sides = resultSides(TEAM_BOUT, { unconfirmed: false, winner: null });
    expect(sides).toEqual({
      redSideId: 'team-lyon',
      blueSideId: 'team-paris',
      winnerSideId: 'team-lyon',
    });
    expect(crowned(sides, 2, 5)).toBe('red');
  });

  it('crowns the tablet’s own leader while its End is not confirmed', () => {
    const sides = resultSides(TEAM_BOUT, { unconfirmed: true, winner: 'blue' });
    expect(sides.winnerSideId).toBe('team-paris');
    expect(crowned(sides, 2, 5)).toBe('blue');
  });

  it('crowns nobody on a loss for both', () => {
    const sides = resultSides(TEAM_BOUT, { unconfirmed: false, winner: null });
    expect(
      resultWinner({ ...sides, resultReason: 'max_doubles', redScore: 0, blueScore: -1 }),
    ).toBeNull();
  });
});

describe('the result screen of a Fighters’ bout', () => {
  const FIGHTERS = {
    redRegistrationId: 'reg-anna',
    blueRegistrationId: 'reg-ben',
    winnerRegistrationId: 'reg-anna',
  };

  it('crowns the recorded Fighter, on a copy kept before the team ids', () => {
    const sides = resultSides(FIGHTERS, { unconfirmed: false, winner: null });
    expect(sides).toEqual({
      redSideId: 'reg-anna',
      blueSideId: 'reg-ben',
      winnerSideId: 'reg-anna',
    });
    expect(crowned(sides, 1, 4)).toBe('red');
  });

  it('names no winner of its own when the tablet’s End names none', () => {
    expect(resultSides(FIGHTERS, { unconfirmed: true, winner: undefined }).winnerSideId).toBeNull();
  });
});

describe('the screens', () => {
  // web-staff has no React test setup: the screens are read as text.
  const read = (name: string) => readFileSync(join(__dirname, name), 'utf8');

  it('the bout screen hands the overlay the side keys and the winner’s', () => {
    const view = read('MatchView.tsx');
    expect(view).toContain(
      'const sideIds = resultSides(match, { unconfirmed, winner: ownWinner });',
    );
    expect(view).toContain('winnerSideId={sideIds.winnerSideId}');
    expect(read('MatchResultOverlay.tsx')).toContain('const winner = resultWinner({');
  });
});
