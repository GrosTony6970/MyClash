import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ApiFailure } from '@myclash/api-client';
import type { Settled } from './settle-undone';
import * as settle from './settle-undone';
import { watchUndone } from './watch-undone';

/**
 * While a bout screen is open, the undos written down are settled (ruling
 * 350): at once, when the network is back, at each end of a send, and every
 * 15 seconds, for a wifi that comes back with no event and nothing to send.
 *
 * Ruling 354. He undid hit 5 with no connection; the bout was locked before the
 * wifi came back, so the server refused the void. Hit 5 came back on the list
 * and the screen said nothing. The screen of THAT bout is now told the refusal.
 */
const API_URL = 'http://localhost:4000';

function watching(settled: Array<[string, Settled]> = []) {
  const runs = vi.spyOn(settle, 'settleUndone').mockResolvedValue(new Map(settled));
  const heard: Record<string, () => void> = {};
  const win = {
    addEventListener: vi.fn((name: string, hear: () => void) => (heard[name] = hear)),
    removeEventListener: vi.fn((name: string) => delete heard[name]),
    setInterval: (run: () => void, ms: number) => setInterval(run, ms),
    clearInterval: (tick: number) => clearInterval(tick),
  };
  let sendEnded: (() => void) | null = null;
  const engine = {
    onSendEnded: (ended: () => void) => {
      sendEnded = ended;
      return () => (sendEnded = null);
    },
  };
  const onSettled = vi.fn();
  const onRan = vi.fn();
  const stop = watchUndone({ engine, apiUrl: API_URL, onSettled, onRan, win: win as never });
  const endSend = () => sendEnded?.();
  return { runs, heard, onSettled, onRan, stop, endSend, listens: () => sendEnded };
}

const refusal = (status: number, code: string): ApiFailure => ({
  kind: 'http',
  status,
  code,
  detail: null,
  details: null,
  validationErrors: null,
});
const LOCKED = refusal(400, 'BAD_REQUEST');
const GONE = refusal(404, 'NOT_FOUND');

/** Let the run in flight end: its answer is a resolved promise. */
const ended = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('watchUndone', () => {
  it('settles at once, for every bout', () => {
    const { runs } = watching();

    expect(runs.mock.calls).toEqual([[API_URL]]);
  });

  it('settles again when the network is back, when a send ends, and every 15 seconds', async () => {
    const { runs, heard, endSend } = watching();
    await ended();

    heard['online']?.();
    expect(runs).toHaveBeenCalledTimes(2);
    await ended();
    endSend();
    expect(runs).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(14_999);
    expect(runs).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(runs).toHaveBeenCalledTimes(4);
  });

  // A dead wifi: a run takes seconds per bout, and the triggers keep coming.
  it('drops a trigger that meets a run in flight, and runs again once it ended', async () => {
    const { runs, heard, endSend } = watching();
    let end: (settled: Map<string, Settled>) => void = () => {};
    runs.mockReturnValueOnce(new Promise((resolve) => (end = resolve)));
    await ended();

    endSend();
    heard['online']?.();
    await vi.advanceTimersByTimeAsync(45_000);
    expect(runs).toHaveBeenCalledTimes(2);

    end(new Map());
    await ended();
    endSend();
    expect(runs).toHaveBeenCalledTimes(3);
  });

  it.each<[string, Settled]>([
    ['voided an entry on the server', 'voided'],
    ['filed a request for review', 'review'],
    ['was refused by the server', { refused: LOCKED, matchId: 'm1' }],
    ['let an old undo go', 'expired'],
    ['let an undo of an ended bout go', 'ended'],
  ])('tells the screen when a run %s', async (_what, settled) => {
    const { onSettled } = watching([
      ['uuid-1', 'absent'],
      ['uuid-2', settled],
    ]);
    await ended();

    expect(onSettled).toHaveBeenCalledOnce();
  });

  it.each<[string, Settled]>([
    ['nothing was on the server', 'absent'],
    ['the entry is kept', 'kept'],
  ])('does not tell the screen when %s', async (_what, settled) => {
    const { onSettled } = watching([['uuid-1', settled]]);
    await ended();

    expect(onSettled).not.toHaveBeenCalled();
  });

  // Rulings 364 to 366. The settle writes down what it did not carry out, with its bout:
  // the screen reads what is written for its own bout after every run, whatever the run did.
  it.each<[string, Array<[string, Settled]>]>([
    ['settled nothing', []],
    ['kept every entry', [['uuid-1', 'kept']]],
    ['met a refusal about another bout', [['uuid-1', { refused: GONE, matchId: 'm2' }]]],
    ['let an undo of an ended bout go', [['uuid-1', 'ended']]],
  ])('tells the screen a run ended when it %s', async (_what, settled) => {
    const { onRan } = watching(settled);
    await ended();

    expect(onRan).toHaveBeenCalledOnce();
  });

  it('tells the screen after each run, once per run', async () => {
    const { onRan, endSend } = watching();
    await ended();
    endSend();
    await ended();

    expect(onRan).toHaveBeenCalledTimes(2);
  });

  it('a run that throws is logged, and the next one still runs', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { runs, endSend } = watching();
    await ended();
    runs.mockRejectedValueOnce(new Error('the store failed'));

    endSend();
    await ended();
    endSend();

    expect(logged).toHaveBeenCalledOnce();
    expect(runs).toHaveBeenCalledTimes(3);
  });

  it('its stop ends all three: the event, the send’s end, the timer', async () => {
    const { runs, heard, stop, listens } = watching();

    stop();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(heard['online']).toBeUndefined();
    expect(listens()).toBeNull();
    expect(runs).toHaveBeenCalledOnce();
  });

  // The bout screen closed while a run was out: its answer is for nobody.
  it('a run in flight at the stop tells no screen', async () => {
    const { onSettled, onRan, stop } = watching([['uuid-1', { refused: LOCKED, matchId: 'm1' }]]);

    stop();
    await ended();

    expect(onSettled).not.toHaveBeenCalled();
    expect(onRan).not.toHaveBeenCalled();
  });
});

describe('the bout screen', () => {
  const page = readFileSync(
    join(__dirname, '..', '..', 'app', 'matches', '[matchId]', 'page.tsx'),
    'utf8',
  );

  const notice = readFileSync(join(__dirname, '..', 'components', 'RememberedUndos.tsx'), 'utf8');

  it('mounts the watcher of its own bout, and reads the bout again after a settle', () => {
    expect(page).toMatch(
      /\{matchId && \(\s+<RememberedUndos\s+key=\{matchId\}\s+engine=\{syncEngine\}\s+apiUrl=\{apiUrl\}\s+matchId=\{matchId\}\s+onSettled=\{readBoutAgain\}\s+\/>\s+\)\}/,
    );
    expect(page).not.toContain('watchUndone');
  });

  it('watches while it is open, and stops when it closes', () => {
    expect(notice).toContain(
      'const stop = watchUndone({ engine, apiUrl, onSettled, onRan: read, win: window });',
    );
    expect(notice).toMatch(/return \(\) => \{\s+gone = true;\s+stop\(\);\s+\};/);
    expect(notice).toContain('}, [engine, apiUrl, matchId, onSettled]);');
  });

  // Ruling 364: what was written while another screen was open is read when this one opens.
  it('reads what is written for its bout when it opens, and after every run', () => {
    expect(notice).toMatch(/\n {4}read\(\);\n {4}const stop = watchUndone\(/);
    expect(notice).toContain('void noticesOf(matchId).then((rows) => {');
    expect(notice).toContain(
      'if (!gone) setNotices(rows.filter((row) => !closed.current.has(row.clientUuid)));',
    );
  });

  it('says them in the words of the pure module, until they are closed', () => {
    expect(notice).toContain('if (notices.length === 0) return null;');
    expect(notice).toMatch(
      /role="alert"[\s\S]+\{undoNoticeLines\(notices, t\)\.map\(\(line\) => \(\s+<p key=\{line\}>\{line\}<\/p>\s+\)\)\}/,
    );
    // The pad's touch target: never under 44px (docs/design/web-staff.md).
    expect(notice).toContain('className="min-h-[44px] shrink-0');
    expect(notice).toContain('onClick={close}');
  });

  // Only the rows he read are removed: one written since stays for the next read.
  it('removes the rows it showed when he closes the notice, and shows them no more', () => {
    expect(notice).toMatch(
      /const close = \(\) => \{\s+for \(const notice of notices\) closed\.current\.add\(notice\.clientUuid\);\s+setNotices\(\[\]\);\s+void saidNotices\(notices\);\s+\};/,
    );
  });
});
