import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { blackCardLoserName } from './black-card-loss';
import type { MatchPenalty } from '../hooks/usePenalties';

function penalty(p: Partial<MatchPenalty>): MatchPenalty {
  return {
    id: 'p1',
    sequence: 1,
    registration_id: 'reg-x',
    team_id: null,
    card: 'yellow',
    source: 'ruleset',
    short_name: null,
    reason: null,
    score_delta: 0,
    causes_match_forfeit: false,
    voided: false,
    ...p,
  };
}

/** Anna (red) and Ben (blue), a Fighters' bout. */
const FIGHTERS = { redSideId: 'reg-a', blueSideId: 'reg-b', redName: 'Anna', blueName: 'Ben' };

/** Lyon Blades (red) and Paris Rapiers (blue), a team bout: its sides have no Registration. */
const TEAMS = {
  redSideId: 'team-lyon',
  blueSideId: 'team-paris',
  redName: 'Lyon Blades',
  blueName: 'Paris Rapiers',
};

describe('blackCardLoserName', () => {
  it('names the carded fighter when a black card ended the match', () => {
    const penalties = [
      penalty({ card: 'yellow', registration_id: 'reg-a' }),
      penalty({ card: 'black', registration_id: 'reg-b' }),
    ];
    expect(blackCardLoserName({ endReason: 'black_card', penalties, ...FIGHTERS })).toBe('Ben');
  });

  // Anna of Lyon takes a black card in a team Pool Match: the team loses this Match (ruling 972).
  it('names the carded team when a black card on a team ended the match', () => {
    const penalties = [penalty({ card: 'black', registration_id: null, team_id: 'team-lyon' })];
    expect(blackCardLoserName({ endReason: 'black_card', penalties, ...TEAMS })).toBe(
      'Lyon Blades',
    );
  });

  it('names nobody when the match did not end on a black card', () => {
    const penalties = [penalty({ card: 'black', registration_id: 'reg-b' })];
    expect(blackCardLoserName({ endReason: 'max_doubles', penalties, ...FIGHTERS })).toBeNull();
    expect(blackCardLoserName({ endReason: null, penalties, ...FIGHTERS })).toBeNull();
  });

  it('ignores a voided black card', () => {
    const penalties = [penalty({ card: 'black', registration_id: 'reg-b', voided: true })];
    expect(blackCardLoserName({ endReason: 'black_card', penalties, ...FIGHTERS })).toBeNull();
  });

  // web-staff has no React test setup: the banner's wiring is read as text.
  it('the banner names the side the bout screen gives by side key', () => {
    const centre = readFileSync(join(__dirname, 'ScoringCenterControls.tsx'), 'utf8');
    expect(centre).toMatch(
      /const blackCardLoser = blackCardLoserName\(\{[^}]*redSideId,\s+blueSideId,/,
    );
    expect(centre).toContain('{blackCardLoser}</p>');
    const view = readFileSync(join(__dirname, 'MatchView.tsx'), 'utf8');
    expect(view).toContain('redSideId={sideIds.redSideId}');
  });

  // A side still to come is null: null is nobody, never that side.
  it('names nobody for a card of neither side', () => {
    const penalties = [penalty({ card: 'black', registration_id: 'reg-z' })];
    expect(
      blackCardLoserName({ endReason: 'black_card', penalties, ...FIGHTERS, blueSideId: null }),
    ).toBeNull();
  });
});
