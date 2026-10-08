import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Settled } from './settle-undone';
import * as settle from './settle-undone';
import { watchUndone } from './watch-undone';

/**
 * While a bout screen is open, the undos written down are settled (ruling
 * 350): at once, when the network is back, at each end of a send, and every
 * 15 seconds, for a wifi that comes back with no event and nothing to send.
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
  const stop = watchUndone({ engine, apiUrl: API_URL, onSettled, win: win as never });
  return { runs, heard, onSettled, stop, endSend: () => sendEnded?.(), listens: () => sendEnded };
}

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
    ['was refused by the server', { refused: { kind: 'network' } }],
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
});

describe('the bout screen', () => {
  const page = readFileSync(
    join(__dirname, '..', '..', 'app', 'matches', '[matchId]', 'page.tsx'),
    'utf8',
  );

  it('watches while it is open, reads the bout again after a settle, and stops when it closes', () => {
    expect(page).toMatch(
      /useEffect\(\s+\(\) => watchUndone\(\{ engine: syncEngine, apiUrl, onSettled: readBoutAgain, win: window \}\),\s+\[syncEngine, apiUrl, readBoutAgain\],\s+\);/,
    );
  });
});
