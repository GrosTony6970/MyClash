/**
 * No press of the pad waits for the send, and a scored hit reads the server
 * once (ruling 316): the screens' side.
 *
 * web-staff has no React test setup, so the screens are read as text. These
 * pins hold the WIRING only; the engine's side is `offline/sync.drain-again.test.ts`,
 * and the one read per endpoint per hit is counted in a browser by
 * `tests/e2e/16-pad-ui.spec.ts`.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (...path: string[]) => readFileSync(join(__dirname, '..', ...path), 'utf8');
const page = () => read('..', 'app', 'matches', '[matchId]', 'page.tsx');

describe('a press', () => {
  it('asks for a send and goes on: a hit, a list card and a direct card', () => {
    for (const file of [
      ['hooks', 'useScoringSubmit.ts'],
      ['components', 'ScoringColumn.tsx'],
      ['components', 'DirectCardPanel.tsx'],
    ]) {
      const source = read(...file);
      expect(source, file[1]).toContain('syncEngine?.sendBehind()');
      expect(source, file[1]).not.toMatch(/\.drain\(\)/);
    }
  });

  it('moves its sequence on and reads nothing from the server', () => {
    const view = read('components', 'MatchView.tsx');
    expect(view).toContain(
      'const moveSequenceOn = useCallback(() => setNextSequence((n) => n + 1), []);',
    );
    expect(view).toContain('onExchangeRecorded: moveSequenceOn,');
    expect(view.match(/onPenaltyRecorded=\{moveSequenceOn\}/g)).toHaveLength(2);
    expect(view).toContain('onCardQueued={moveSequenceOn}');
  });
});

describe('the end of a pass of the send', () => {
  it('reads the lists again in the bout screen, and moves no sequence', () => {
    const view = read('components', 'MatchView.tsx');
    expect(view).toContain(
      'const readListsAgain = useCallback(() => setRefreshKey((k) => k + 1), []);',
    );
    expect(view).toContain('useSendEnded(syncEngine, readListsAgain);');
    expect(read('offline', 'use-sync-state.ts')).toContain(
      'useEffect(() => engine?.onSendEnded(ended), [engine, ended]);',
    );
  });

  it('reads the bout again in the page, which listens before it starts the first send', () => {
    const source = page();
    expect(source).toContain(
      'const readBoutAgain = useCallback(() => setRefreshKey((key) => key + 1), []);',
    );
    expect(source).toContain('onRefresh={readBoutAgain}');
    const listens = source.indexOf('useSendEnded(syncEngine, readBoutAgain);');
    expect(listens).toBeGreaterThan(0);
    expect(listens).toBeLessThan(source.indexOf('syncEngine.sendBehind();'));
  });
});

describe('the page’s reads of the bout', () => {
  it('nobody waits for the sends the page starts', () => {
    const source = page();
    // A tablet opened again, and the server's bout in place of the copy.
    expect(source.match(/syncEngine\.sendBehind\(\);/g)).toHaveLength(2);
    // The network back: after the send that left before it, never beside it.
    expect(source.match(/syncEngine\.sendAfterReconnect\(\);/g)).toHaveLength(1);
    expect(source).not.toMatch(/\.drain\(\)/);
  });

  it('an answer that lands after a later read’s answer does not win, and no answer is thrown away before', () => {
    const source = page();
    expect(source).toContain('const boutReads = useRef({ asked: 0, shown: 0 });');
    expect(source).toContain('const read = (boutReads.current.asked += 1);');
    expect(source).toContain('if (read < boutReads.current.shown) return false;');
    expect(source).toContain('boutReads.current.shown = read;');
    // One gate for both answers of the server: the bout, and a bout that is gone.
    expect(source).toMatch(
      /if \(!isNewestAnswer\(\)\) return;\s+if \(answer\.kind !== 'bout'\) \{\s+setShown\(null\);/,
    );
    expect(source.match(/isNewestAnswer\(\)/g)).toHaveLength(1);
    // A read that was replaced still ends the first load: no cleanup marks it.
    expect(source).not.toContain('stale');
    expect(source.match(/setLoading\(false\);/g)).toHaveLength(2);
  });
});
