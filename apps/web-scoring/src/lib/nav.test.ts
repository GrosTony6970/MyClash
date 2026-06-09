import { describe, expect, it } from 'vitest';
import { safeReturnHref, scoringRoutePrefix } from './nav';

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

describe('scoringRoutePrefix', () => {
  it('returns /scoring when mounted under the admin same-origin proxy', () => {
    expect(scoringRoutePrefix('/scoring/matches/abc')).toBe('/scoring');
  });

  it('returns empty string on the canonical scoring subdomain (root mount)', () => {
    expect(scoringRoutePrefix('/matches/abc')).toBe('');
    expect(scoringRoutePrefix('/lices/abc')).toBe('');
  });
});
