import { describe, it, expect } from 'vitest';
import { buildScoringHref, buildMatchScoringHref, STAFF_APP_PREFIX } from './build-scoring-href';

describe('STAFF_APP_PREFIX', () => {
  it('is the path the staff app is actually mounted at', () => {
    // The one assertion that would have caught the dead link. The scoring PWA
    // became the staff app in `11db3c66` and the proxy moved to `/staff`, but
    // all four admin call sites kept a hardcoded `'/scoring'` — so every "score
    // this match" action sent an organiser to a 404, in production, for a day.
    // Every caller now reads this constant, so this line is the whole guard.
    expect(STAFF_APP_PREFIX).toBe('/staff');
  });
});

describe('buildScoringHref', () => {
  it('joins the scoring base URL with the lice path when both args are present', () => {
    expect(buildScoringHref('https://staff.myclash.fr', 'lice-1')).toBe(
      'https://staff.myclash.fr/lices/lice-1',
    );
  });

  it('returns null when the match has no lice assigned', () => {
    expect(buildScoringHref('https://staff.myclash.fr', null)).toBeNull();
  });

  it('strips a trailing slash from the base URL', () => {
    // Operator-set envs and CI configs disagree on whether the base URL
    // ends in a slash; the helper normalises so we never emit `//lices/...`.
    expect(buildScoringHref('https://staff.myclash.fr/', 'lice-1')).toBe(
      'https://staff.myclash.fr/lices/lice-1',
    );
    expect(buildScoringHref('http://localhost:3002///', 'lice-2')).toBe(
      'http://localhost:3002/lices/lice-2',
    );
  });
});

describe('buildMatchScoringHref', () => {
  it('joins the scoring base URL with the match path when both args are present', () => {
    expect(buildMatchScoringHref('https://staff.myclash.fr', 'match-1')).toBe(
      'https://staff.myclash.fr/matches/match-1',
    );
  });

  it('returns null when the matchId is null', () => {
    expect(buildMatchScoringHref('https://staff.myclash.fr', null)).toBeNull();
  });

  it('strips trailing slashes from the base URL', () => {
    expect(buildMatchScoringHref('https://staff.myclash.fr/', 'match-1')).toBe(
      'https://staff.myclash.fr/matches/match-1',
    );
    expect(buildMatchScoringHref('http://localhost:3002///', 'match-2')).toBe(
      'http://localhost:3002/matches/match-2',
    );
  });

  it('appends an encoded ?return= when the caller passes one', () => {
    expect(
      buildMatchScoringHref('https://staff.myclash.fr', 'match-1', '/org/foo/events/bar/bracket'),
    ).toBe('https://staff.myclash.fr/matches/match-1?return=%2Forg%2Ffoo%2Fevents%2Fbar%2Fbracket');
  });

  it('omits ?return= when null/undefined so bookmarks stay clean', () => {
    expect(buildMatchScoringHref('https://staff.myclash.fr', 'match-1', null)).toBe(
      'https://staff.myclash.fr/matches/match-1',
    );
    expect(buildMatchScoringHref('https://staff.myclash.fr', 'match-1')).toBe(
      'https://staff.myclash.fr/matches/match-1',
    );
  });

  it('works with a same-origin path prefix (admin Traefik proxy)', () => {
    expect(buildMatchScoringHref('/scoring', 'match-1', '/org/foo')).toBe(
      '/scoring/matches/match-1?return=%2Forg%2Ffoo',
    );
  });

  it('appends an encoded externalDisplay alongside return', () => {
    expect(
      buildMatchScoringHref(
        '/scoring',
        'match-1',
        '/org/foo/pools',
        '/org/foo/events/bar/matches/match-1/scoreboard',
      ),
    ).toBe(
      '/scoring/matches/match-1?return=%2Forg%2Ffoo%2Fpools&externalDisplay=%2Forg%2Ffoo%2Fevents%2Fbar%2Fmatches%2Fmatch-1%2Fscoreboard',
    );
  });

  it('omits externalDisplay when null', () => {
    expect(buildMatchScoringHref('/scoring', 'match-1', '/org/foo', null)).toBe(
      '/scoring/matches/match-1?return=%2Forg%2Ffoo',
    );
  });
});
