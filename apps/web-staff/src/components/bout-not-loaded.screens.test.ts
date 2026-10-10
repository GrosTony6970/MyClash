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
 * (`tests/a11y/pad-bout-no-network.spec.ts`), and `bout-read.test.ts` holds
 * what counts as "no network".
 *
 * A bout the tablet has read opens from the tablet's copy instead (rulings 3,
 * 9, 10): `tests/a11y/pad-bout-from-tablet.spec.ts`, `kept-bout.test.ts`.
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
      /if \(answer\.kind === 'unreachable'\) \{\s+setUnreachable\(true\);\s+const kept = await keptBout\(matchId\)\.catch\(\(\) => null\);\s+if \(kept && read >= boutReads\.current\.shown\) setShown\(\(now\) => now \?\? kept\);\s+setLoading\(false\);\s+return;\s+\}/,
    );
  });

  it('opens the tablet’s copy only while the screen holds no bout', () => {
    // A server answer that landed first is never replaced by the copy: not the
    // bout on screen, and not the "gone" of a later read.
    expect(page.match(/keptBout\(/g)).toHaveLength(1);
    expect(page).toContain(
      'if (kept && read >= boutReads.current.shown) setShown((now) => now ?? kept);',
    );
  });

  it('gives the server’s bout a screen of its own, and sends what the tablet holds', () => {
    expect(page).toContain("key={fromTablet ? 'copy' : 'server'}");
    expect(page).toMatch(
      /if \(shownFromTablet\.current && !fromTablet\) syncEngine\.sendBehind\(\);\s+shownFromTablet\.current = fromTablet;\s+\}, \[fromTablet, syncEngine\]\);/,
    );
  });

  it('forgets the mark when the server answers, before the count of the answers is asked', () => {
    expect(page.match(/setUnreachable\(false\);/g)).toHaveLength(1);
    expect(page).toMatch(
      /setUnreachable\(false\);\s+setLoading\(false\);\s+if \(!isNewestAnswer\(\)\) return;/,
    );
  });

  it('keeps the bout the server gave, and forgets the one it said is gone', () => {
    expect(page).toMatch(
      /if \(answer\.kind !== 'bout'\) \{\s+setShown\(null\);[^}]*if \(answer\.kind === 'gone'\) void forgetBout\(matchId\)\.catch\(\(\) => undefined\);\s+return;\s+\}\s+setShown\(\{ match: answer\.match, readAt: null \}\);/,
    );
    // A bout with no names is shown, and not kept over a copy that has them.
    expect(page).toContain(
      'if (answer.labelled) void keepBout(answer.match).catch(() => undefined);',
    );
  });

  it('holds the bout and where it came from as one state', () => {
    expect(page).toContain('const match = shown?.match ?? null;');
    expect(page).toContain('const fromTablet = shown !== null && shown.readAt !== null;');
    expect(page).toContain('readFromTabletAt={shown?.readAt ?? null}');
    expect(page).not.toContain('setMatch(');
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
      /const handleOnline = \(\) => \{\s+setNetworkStatus\('online'\);[^}]*syncEngine\.sendAfterReconnect\(\);[^}]*readBoutAgain\(\);\s+\};/,
    );
  });
});

describe('a bout not loaded', () => {
  it('is asked for again by itself, while the server has not given it: no bout, or the copy', () => {
    expect(page).toContain('const awaitsServer = unreachable && (shown === null || fromTablet);');
    expect(page).toMatch(
      /if \(!awaitsServer\) return;\s+const timer = window\.setInterval\(readBoutAgain, BOUT_NOT_LOADED_RETRY_MS\);\s+return \(\) => window\.clearInterval\(timer\);\s+\}, \[awaitsServer, readBoutAgain\]\);/,
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
