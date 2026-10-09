/**
 * A bout opened with no network says "no connection", and opens by itself
 * when the network is back: the screens' side.
 *
 * The official opens a bout in a hall with no wifi. The page kept no bout and
 * said "Match unavailable, it may have been deleted or rescheduled". It stayed
 * so after the wifi returned: nothing read the bout again.
 *
 * web-staff has no React test setup, so the screens are read as text. These
 * pins hold the WIRING only; a live page proves what the official reads
 * (`tests/a11y/pad-bout-no-network.spec.ts`), and `failure-kind.test.ts` holds
 * what counts as "no network".
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (...path: string[]) => readFileSync(join(__dirname, '..', ...path), 'utf8');
const page = read('..', 'app', 'matches', '[matchId]', 'page.tsx');
const view = read('components', 'MatchView.tsx');

describe('the page’s read of the bout', () => {
  it('marks a read that met no network, and clears no bout for it', () => {
    expect(page).toMatch(
      /if \(classifySyncFailure\(rawRes\.status, body\) === 'offline'\) \{\s+setUnreachable\(true\);\s+return;\s+\}/,
    );
    // A request with no answer at all (no service worker) is the same verdict.
    expect(page).toMatch(/\} catch \{[^}]*setUnreachable\(true\);\s+\} finally \{/);
  });

  it('forgets the mark when the server answers: the bout, or a bout that is gone', () => {
    expect(page.match(/setUnreachable\(false\);/g)).toHaveLength(2);
    // Before the count of the answers is asked: an answer is an answer.
    expect(page).toMatch(/setUnreachable\(false\);\s+if \(isNewestAnswer\(\)\) setMatch\(null\);/);
    expect(page).toMatch(/setUnreachable\(false\);\s+const raw = \(await rawRes\.json\(\)\) as \{/);
  });

  it('says "no connection" only while it holds no bout', () => {
    expect(page).toMatch(
      /\{match \? \(\s+<MatchView[\s\S]+?\/>\s+\) : unreachable \? \(\s+<BoutNotLoadedView onRetry=\{readBoutAgain\} \/>\s+\) : \(\s+<NoMatchView mode="match" \/>/,
    );
  });
});

describe('the network coming back', () => {
  it('reads the bout again, whatever the queue holds', () => {
    expect(page).toMatch(
      /const handleOnline = \(\) => \{\s+setNetworkStatus\('online'\);\s+syncEngine\.sendBehind\(\);[^}]*readBoutAgain\(\);\s+\};/,
    );
  });
});

describe('a bout not loaded', () => {
  it('is asked for again by itself, and only while it is not loaded', () => {
    expect(page).toMatch(
      /if \(match \|\| !unreachable\) return;\s+const timer = window\.setInterval\(readBoutAgain, BOUT_NOT_LOADED_RETRY_MS\);\s+return \(\) => window\.clearInterval\(timer\);\s+\}, \[match, unreachable, readBoutAgain\]\);/,
    );
  });
});

describe('the screen of a bout not loaded', () => {
  const screen = view.slice(view.indexOf('export function BoutNotLoadedView('));

  it('has a Retry the size of a finger, in the reader’s language', () => {
    expect(screen).toContain("{t('scoring.match.notLoadedTitle')}");
    expect(screen).toContain("{t('scoring.match.notLoadedBody')}");
    expect(screen).toMatch(
      /<button\s+type="button"\s+onClick=\{onRetry\}\s+className="[^"]*min-h-\[44px\]/,
    );
    expect(screen).toContain("{t('scoring.lice.retry')}");
  });
});
