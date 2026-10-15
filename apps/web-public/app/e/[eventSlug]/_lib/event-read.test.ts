import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { eventReadFailure } from './event-read';

/**
 * "Event not found" is said only when it is true (quick win F13).
 *
 * The read of an Event answered `null` for a 404, a 500 and a dead network
 * alike, and sent no login. So an outage read as a missing Event, a missing
 * Event as a near-blank page, and a club member's own draft as missing.
 */
describe('what a read that gave no Event says', () => {
  it('a 404 says the Event is not there', () => {
    expect(eventReadFailure(404)).toEqual({ kind: 'notFound' });
  });

  it.each([400, 401, 403, 429, 500, 502, 503])('a %i is a failure, never "not found"', (status) => {
    expect(eventReadFailure(status)).toEqual({ kind: 'failed' });
  });

  it('a read that never landed is a failure', () => {
    expect(eventReadFailure(null)).toEqual({ kind: 'failed' });
  });
});

const EVENT_PAGES = join(__dirname, '..');
const read = (...path: string[]) => readFileSync(join(EVENT_PAGES, ...path), 'utf8');

/** This package's vitest does not compile TSX, so the pages are read as text. */
describe('the read itself', () => {
  const source = read('_components', 'EventHeader.tsx');

  it('carries who asks, and answers a refusal by its status and a throw as a failure', () => {
    expect(source).toMatch(/cache: 'no-store',\s+\.\.\.who,/);
    expect(source).toContain('if (!res.ok) return eventReadFailure(res.status);');
    expect(source).toMatch(/\} catch \{\s+return eventReadFailure\(null\);/);
    expect(source).not.toContain('return null;');
  });

  /**
   * The layout once read the Event a second time, through a helper this file's
   * sweep could not see, to set a CSS variable and a data attribute that nothing
   * read. The header draws the logo and the hero image; the layout reads nothing.
   */
  it('the Event layout makes no read of its own', () => {
    expect(read('layout.tsx')).not.toMatch(/\bfetch|getServerApiUrl|Theme\(/);
  });

  it('on the server it sends the login, once per request, and a missing Event is the not-found page', () => {
    const server = read('_lib', 'event-or-not-found.ts');
    expect(server).toMatch(/export const readEventOnce = cache\(/);
    expect(server).toContain(
      'fetchEventInfo(eventSlug, getServerApiUrl(), { headers: await requestLoginHeader() })',
    );
    expect(server).toMatch(/if \(read\.kind === 'notFound'\) notFound\(\);\s+throw new Error\(/);
  });
});

/** Every `.ts` / `.tsx` file under the Event's pages that is drawn on the server. */
function serverSources(dir: string): Array<{ file: string; source: string }> {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return serverSources(path);
    if (!/\.tsx?$/.test(name) || /\.test\.tsx?$/.test(name)) return [];
    const source = readFileSync(path, 'utf8');
    return source.startsWith("'use client'")
      ? []
      : [{ file: path.slice(EVENT_PAGES.length + 1), source }];
  });
}

/**
 * A SWEEP, not a list: a server file under the Event's pages that reads the API
 * sends the visitor's login with every read, or stands in the allow-list with
 * its reason. A read with no login shows a club member an empty block on their
 * own draft Event, and nothing else would say so.
 */
describe('every server read of the Event pages sends the login', () => {
  const NO_LOGIN: Record<string, string> = {
    // The one read of an Event: its caller hands it `who` (pinned above).
    [join('_components', 'EventHeader.tsx')]: 'takes who asks from its caller',
    // The Tournament statistics of a hidden Tournament: older than this rule, named in the list.
    [join('t', '[tournamentSlug]', 'stats-data.ts')]: 'not in the scope of F13',
  };
  // A read sends it as its `headers`, built by one of the two owners in `login-cookie.ts`.
  const sends = (source: string) =>
    /requestLoginHeader\(\)|loginCookieHeader\(/.test(source)
      ? (source.match(/\bheaders: /g) ?? []).length
      : 0;
  const reads = (source: string) => (source.match(/\bfetch\(/g) ?? []).length;
  const readers = serverSources(EVENT_PAGES).filter(({ source }) => reads(source) > 0);

  it('finds the readers (a sweep that scans nothing proves nothing)', () => {
    expect(readers.length).toBeGreaterThanOrEqual(8);
  });

  it.each(readers.filter(({ file }) => !(file in NO_LOGIN)))(
    '$file sends it with each read',
    ({ source }) => {
      expect(sends(source)).toBeGreaterThanOrEqual(reads(source));
    },
  );

  it('the allow-list names only files that exist and still read without it', () => {
    for (const file of Object.keys(NO_LOGIN)) {
      const reader = readers.find((r) => r.file === file);
      expect(reader, file).toBeDefined();
      expect(sends(reader!.source), file).toBeLessThan(reads(reader!.source));
    }
  });

  /**
   * The home's live block is drawn from the server's read, then reads again in
   * the browser. Without the login there, a club member's draft Event lost its
   * live block at the first read from the browser.
   */
  it("the home's live block reads with the login from the browser too", () => {
    // It reads through the live board's reader, whose `apiRequest` sends the login by default.
    const block = read('home', '_components', 'LiveNowSection.tsx');
    expect(reads(block)).toBe(0);
    expect(block).toContain('useLiveBoard(eventSlug, initialState)');
    const board = read('live', 'use-live-board.ts');
    expect(reads(board)).toBe(0);
    expect(board).toContain('await apiRequest<LiveState>(');
    expect(board).not.toContain('credentials:');
  });
});
