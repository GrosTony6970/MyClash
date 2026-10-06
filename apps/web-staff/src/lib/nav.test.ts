import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  displayUrlForMatch,
  isExternalHref,
  safeReturnHref,
  staffRoutePrefix,
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

  // Proven in a browser: with the older check, one click on Back left the site.
  it.each(['/\\evil.com/x', '/\t/evil.com/x', '/.//evil.com/x'])(
    'rejects %j, which a browser reads as another site',
    (asked) => {
      expect(safeReturnHref(asked, origin)).toBeNull();
    },
  );

  // Our origin, but a path the one rule refuses, or a scheme that only wraps our origin.
  it.each([
    'https://admin.myclash.fr//evil.com',
    'https://admin.myclash.fr/\\evil.com',
    'https://admin.myclash.fr/.//evil.com',
    'blob:https://admin.myclash.fr/x',
  ])('rejects the same-origin absolute URL %j', (asked) => {
    expect(safeReturnHref(asked, origin)).toBeNull();
  });

  it('hands an oddly written same-origin URL back as our origin plus its path', () => {
    expect(safeReturnHref('HTTPS://user@ADMIN.MYCLASH.FR/org/x?tab=1#matches', origin)).toBe(
      'https://admin.myclash.fr/org/x?tab=1#matches',
    );
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

describe('staffRoutePrefix', () => {
  it('returns /staff when mounted under the admin same-origin proxy', () => {
    expect(staffRoutePrefix('/staff/matches/abc')).toBe('/staff');
  });

  it('returns empty string on the canonical staff subdomain (root mount)', () => {
    expect(staffRoutePrefix('/matches/abc')).toBe('');
    expect(staffRoutePrefix('/lices/abc')).toBe('');
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
    expect(displayUrlForMatch('/staff/matches/match-1', 'match-2')).toBe('/staff/matches/match-1');
  });

  // The address comes from `?externalDisplay=` and goes to `window.open`.
  it.each([
    "javascript:opener.document.title='x'",
    'JavaScript:alert(1)//display/match-1',
    'data:text/html,<p>x</p>',
    'https://example.com/display/match-1',
    '//example.com/display/match-1',
    '/\\example.com/display/match-1',
    '/\t/example.com/display/match-1',
    '/.//example.com/display/match-1',
    'display/match-1',
  ])('gives no address for %j, which is not a path of our own site', (asked) => {
    expect(displayUrlForMatch(asked, 'match-2')).toBeNull();
  });

  it('gives no address for a full address, of our own site too: no screen sends one', () => {
    expect(displayUrlForMatch('https://admin.myclash.fr/display/match-1', 'match-2')).toBeNull();
  });

  it('asks the rule of the address the browser gets, with the bout swapped in', () => {
    // The header hands in the id the API answered, so this id is not a real one.
    // It resolves to the path `//example.com`: the rule refuses the result, and
    // would pass the base alone.
    expect(displayUrlForMatch('/display/match-1', '../..//example.com')).toBeNull();
  });
});

describe('the scoreboard popup', () => {
  const read = (...path: string[]) => readFileSync(join(__dirname, '..', ...path), 'utf8');

  it('is opened by `nav.ts` alone, with the address `displayUrlForMatch` gave', () => {
    const header = read('components', 'MatchHeader.tsx');
    expect(header).toContain('const displayUrl = displayUrlForMatch(externalDisplayUrl, matchId);');
    expect(header.match(/openScoreboardPopup\(|retargetScoreboardPopupIfOpen\(/g)).toHaveLength(2);
    expect(header).toContain('onClick={() => openScoreboardPopup(displayUrl)}');
    expect(header).toContain('if (displayUrl) retargetScoreboardPopupIfOpen(displayUrl);');
    for (const file of [
      ['components', 'MatchHeader.tsx'],
      ['components', 'MatchView.tsx'],
      ['..', 'app', 'matches', '[matchId]', 'page.tsx'],
    ]) {
      expect(read(...file), file.join('/')).not.toContain('window.open(');
    }
  });
});
