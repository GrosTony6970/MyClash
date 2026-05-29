import { describe, it, expect } from 'vitest';
import { buildScoringHref } from './build-scoring-href';

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
