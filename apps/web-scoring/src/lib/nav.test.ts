import { describe, expect, it } from 'vitest';
import {
  displayUrlForMatch,
  isExternalHref,
  safeReturnHref,
  scoringRoutePrefix,
  scoreboardPopupFeatures,
} from './nav';

describe('safeReturnHref', () => {
  const origin = 'https://admin.myclash.fr';

  it('returns a same-origin absolute URL unchanged', () => {
    expect(safeReturnHref('https://admin.myclash.fr/org/x/events/y/pools#matches', origin)).toBe(
      'https://admin.myclash.fr/org/x/events/y/pools#matches',
    );
  });

  it('rejects a cross-origin absolute URL', () => {
    expect(safeReturnHref('https://evil.com/steal', origin)).toBeNull();
  });

  it('returns a root-relative path unchanged', () => {
    expect(safeReturnHref('/org/x/events/y/pools', origin)).toBe('/org/x/events/y/pools');
  });

  it('rejects a protocol-relative URL (open-redirect vector)', () => {
    expect(safeReturnHref('//evil.com/x', origin)).toBeNull();
  });

  it('returns null for empty/null input', () => {
    expect(safeReturnHref(null, origin)).toBeNull();
    expect(safeReturnHref('', origin)).toBeNull();
  });
});

describe('isExternalHref', () => {
  it('is true for an absolute http(s) URL (a hard navigation target)', () => {
    expect(isExternalHref('https://admin.myclash.fr/org/x/events/y/pools#matches')).toBe(true);
    expect(isExternalHref('http://example.com')).toBe(true);
  });

  it('is false for a root-relative in-app path', () => {
    expect(isExternalHref('/lices/abc')).toBe(false);
    expect(isExternalHref('/matches/abc')).toBe(false);
  });

  it('is false for empty/null', () => {
    expect(isExternalHref('')).toBe(false);
    expect(isExternalHref(null)).toBe(false);
  });
});

describe('scoringRoutePrefix', () => {
  it('returns /scoring when mounted under the admin same-origin proxy', () => {
    expect(scoringRoutePrefix('/scoring/matches/abc')).toBe('/scoring');
  });

  it('returns empty string on the canonical scoring subdomain (root mount)', () => {
    expect(scoringRoutePrefix('/matches/abc')).toBe('');
    expect(scoringRoutePrefix('/lices/abc')).toBe('');
  });
});

describe('scoreboardPopupFeatures', () => {
  it('builds a sized, resizable, chromeless popup feature string by default', () => {
    expect(scoreboardPopupFeatures()).toBe(
      'popup=yes,width=1280,height=720,resizable=yes,scrollbars=no',
    );
  });

  it('honours explicit width/height', () => {
    expect(scoreboardPopupFeatures(800, 600)).toBe(
      'popup=yes,width=800,height=600,resizable=yes,scrollbars=no',
    );
  });
});

describe('displayUrlForMatch', () => {
  it('swaps the match id in a /display/{id} base for the current match', () => {
    expect(displayUrlForMatch('/display/match-1', 'match-2')).toBe('/display/match-2');
  });

  it('preserves any query/hash after the id segment', () => {
    expect(displayUrlForMatch('/display/match-1?foo=bar#x', 'match-2')).toBe(
      '/display/match-2?foo=bar#x',
    );
  });

  it('returns null when there is no external-display base', () => {
    expect(displayUrlForMatch(null, 'match-2')).toBeNull();
    expect(displayUrlForMatch(undefined, 'match-2')).toBeNull();
    expect(displayUrlForMatch('', 'match-2')).toBeNull();
  });

  it('leaves a URL without a /display/{id} segment untouched', () => {
    expect(displayUrlForMatch('/scoring/matches/match-1', 'match-2')).toBe(
      '/scoring/matches/match-1',
    );
  });
});
