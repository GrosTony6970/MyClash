import { describe, it, expect } from 'vitest';
import { buildScoringHref, buildMatchScoringHref } from './build-scoring-href';

describe('buildScoringHref', () => {
  it('joins the scoring base URL with the lice path when both args are present', () => {
    expect(buildScoringHref('https://scoring.myclash.fr', 'lice-1')).toBe(
      'https://scoring.myclash.fr/lices/lice-1',
    );
  });

  it('returns null when the match has no lice assigned', () => {
    expect(buildScoringHref('https://scoring.myclash.fr', null)).toBeNull();
  });

  it('strips a trailing slash from the base URL', () => {
    // Operator-set envs and CI configs disagree on whether the base URL
    // ends in a slash; the helper normalises so we never emit `//lices/...`.
    expect(buildScoringHref('https://scoring.myclash.fr/', 'lice-1')).toBe(
      'https://scoring.myclash.fr/lices/lice-1',
    );
    expect(buildScoringHref('http://localhost:3002///', 'lice-2')).toBe(
      'http://localhost:3002/lices/lice-2',
    );
  });
});

describe('buildMatchScoringHref', () => {
  it('joins the scoring base URL with the match path when both args are present', () => {
    expect(buildMatchScoringHref('https://scoring.myclash.fr', 'match-1')).toBe(
      'https://scoring.myclash.fr/matches/match-1',
    );
  });

  it('returns null when the matchId is null', () => {
    expect(buildMatchScoringHref('https://scoring.myclash.fr', null)).toBeNull();
  });

  it('strips trailing slashes from the base URL', () => {
    expect(buildMatchScoringHref('https://scoring.myclash.fr/', 'match-1')).toBe(
      'https://scoring.myclash.fr/matches/match-1',
    );
    expect(buildMatchScoringHref('http://localhost:3002///', 'match-2')).toBe(
      'http://localhost:3002/matches/match-2',
    );
  });
});
