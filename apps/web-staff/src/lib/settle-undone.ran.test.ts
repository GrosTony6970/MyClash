import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';

import { db } from '../offline/db';
import { noticesOf } from '../offline/undo-notices';
import { onSettleRan, settleUndone } from './settle-undone';

/**
 * The bout's screen is told after EVERY run of the settle, whoever asked for it.
 *
 * Marc undid hit 5 of bout A with no wifi. The wifi is back, the bout is locked, and he taps
 * Undo again for hit 6. The tap's own run settles hit 5 too: the server refuses it, and the
 * run writes its notice for this screen. The screen read its notices only after the runs of
 * its 15-second watcher, so the notice showed up to 15 seconds late.
 */
const API_URL = 'http://localhost:4000';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': status >= 400 ? 'application/problem+json' : 'application/json' },
  });
const hit = (id: string, clientUuid: string) => ({
  id,
  client_uuid: clientUuid,
  voided: false,
  sequence: 1,
  occurred_at: '2026-10-06T10:01:00.000Z',
});

/** A server that holds `hits` for a running bout and refuses every void: the bout is locked. */
function lockedServer(hits: unknown[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: { method?: string }) => {
      const path = url.replace(`${API_URL}/api/v1`, '');
      if (init?.method === 'PATCH') {
        return json(400, { status: 400, detail: 'English', code: 'match_locked' });
      }
      if (path.endsWith('/penalty-ruleset')) return json(200, {});
      if (path.endsWith('/exchanges')) return json(200, hits);
      if (path.endsWith('/penalties')) return json(200, []);
      return json(200, { status: 'running' });
    }),
  );
}

const wroteDown = (clientUuid: string) =>
  db.undone.put({ clientUuid, matchId: 'bout-a', undoneAt: Date.now() });

/** A screen that reads its bout's notices when it is told, as `RememberedUndos` does. */
function screen() {
  const read: string[][] = [];
  const stop = onSettleRan(() => {
    void noticesOf('bout-a').then((rows) => read.push(rows.map((row) => row.clientUuid)));
  });
  return { read, stop };
}

beforeEach(async () => {
  await db.undone.clear();
  await db.undoNotices.clear();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the screen is told after every run of the settle', () => {
  it('is told after the run of a tap on Undo, once its notice is written', async () => {
    await wroteDown('uuid-5');
    await wroteDown('uuid-6');
    lockedServer([hit('ex-5', 'uuid-5'), hit('ex-6', 'uuid-6')]);
    const { read, stop } = screen();

    // The tap on Undo for hit 6: its answer is at the button, hit 5's is a notice.
    await settleUndone(API_URL, 'bout-a', 'uuid-6');
    await vi.waitFor(() => expect(read).toEqual([['uuid-5']]));

    stop();
  });

  it('is told once per run, after a run that settled nothing too', async () => {
    const told = vi.fn();
    const stop = onSettleRan(told);

    await settleUndone(API_URL);
    await settleUndone(API_URL);
    await vi.waitFor(() => expect(told).toHaveBeenCalledTimes(2));

    stop();
  });

  it('is told after a run that failed, and the next run still runs', async () => {
    const told = vi.fn();
    const stop = onSettleRan(told);
    vi.spyOn(db.undone, 'toArray').mockRejectedValueOnce(new Error('the store failed'));

    await expect(settleUndone(API_URL)).rejects.toThrow('the store failed');
    await expect(settleUndone(API_URL)).resolves.toEqual(new Map());
    await vi.waitFor(() => expect(told).toHaveBeenCalledTimes(2));

    stop();
  });

  it('tells a screen that closed no more', async () => {
    const told = vi.fn();
    onSettleRan(told)();

    await settleUndone(API_URL);
    await settleUndone(API_URL);

    expect(told).not.toHaveBeenCalled();
  });
});
