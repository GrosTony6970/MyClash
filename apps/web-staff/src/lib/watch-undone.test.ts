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
  const onRefused = vi.fn();
  const stop = watchUndone({
    engine,
    apiUrl: API_URL,
    matchId: 'm1',
    onSettled,
    onRefused,
    win: win as never,
  });
  const endSend = () => sendEnded?.();
  return { runs, heard, onSettled, onRefused, stop, endSend, listens: () => sendEnded };
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

  it('tells the screen each refusal about its own bout, and no other', async () => {
    const { onRefused } = watching([
      ['uuid-1', { refused: GONE, matchId: 'm2' }],
      ['uuid-2', { refused: LOCKED, matchId: 'm1' }],
      ['uuid-3', 'voided'],
      ['uuid-4', { refused: GONE, matchId: 'm1' }],
    ]);
    await ended();

    expect(onRefused.mock.calls).toEqual([[LOCKED], [GONE]]);
  });

  it.each<[string, Settled]>([
    ['voided', 'voided'],
    ['sent for review', 'review'],
    ['kept', 'kept'],
    ['absent', 'absent'],
    ['let go', 'expired'],
  ])('tells no refusal for an entry that was %s', async (_what, settled) => {
    const { onRefused } = watching([['uuid-1', settled]]);
    await ended();

    expect(onRefused).not.toHaveBeenCalled();
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
    const { onSettled, onRefused, stop } = watching([
      ['uuid-1', { refused: LOCKED, matchId: 'm1' }],
    ]);

    stop();
    await ended();

    expect(onSettled).not.toHaveBeenCalled();
    expect(onRefused).not.toHaveBeenCalled();
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
    expect(notice).toMatch(
      /useEffect\(\s+\(\) => watchUndone\(\{ engine, apiUrl, matchId, onSettled, onRefused: setRefused, win: window \}\),\s+\[engine, apiUrl, matchId, onSettled\],\s+\);/,
    );
  });

  it('says a refusal in the words of the pure module, until it is closed', () => {
    expect(notice).toContain('{refusedUndoWords(refused, t)}');
    expect(notice).toContain('if (!refused) return null;');
    expect(notice).toMatch(
      /role="alert"[^>]+>\s+<span [^>]+>\{refusedUndoWords\(refused, t\)\}<\/span>/,
    );
    // The pad's touch target: never under 44px (docs/design/web-staff.md).
    expect(notice).toContain('className="min-h-[44px] shrink-0');
    expect(notice).toContain('onClick={() => setRefused(null)}');
  });
});
