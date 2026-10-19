/**
 * What a Start in the tablet's queue says of the network it was pressed with (ruling "Offline
 * rules", 2026-10-16, and the rulings of 2026-10-17: only a Start pressed with no network keeps
 * the tablet's rules; an online Start takes the Tournament's).
 *
 * The rule: the first send after the tap that learns anything decides. A real answer to any row
 * (an edge 503 too, ruling L) says a network was there: `seen`. A send that met no network and no
 * answer says the Start was pressed with none: `none`. Once judged, never again. The pad's body
 * carries `pressedWithoutNetwork` only for `none`, and only beside the copy it names.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { db, type OutboxEntry } from './db';
import { endOfflineDrill, startOfflineDrill } from './drill';
import { quarantine, requeueRejected } from './outbox';
import { unsentStarts } from './press-queue';
import { SyncEngine } from './sync';
import { API_URL, OFFLINE, addHit, addPress, clearStore, type Answer } from './sync.press.fixtures';

const COPY_A = 'c0000000-0000-4000-8000-00000000000a';
const TAKEN: Answer = { status: 200, body: { status: 'running', matchId: 'm1' } };
const SAVED: Answer = { status: 201, body: { id: 'saved' } };

beforeEach(clearStore);
afterEach(endOfflineDrill);

/**
 * The server, one POST at a time: `answer` from the call count and the body; `before` runs before
 * the answer leaves (a tap while the send is on its way).
 */
function server(
  answer: (nth: number, body: Record<string, unknown>) => Answer,
  before?: (nth: number) => Promise<unknown>,
) {
  const bodies: Array<Record<string, unknown>> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: { method?: string; body?: string }) => {
      if ((init?.method ?? 'GET') === 'GET') {
        return { ok: true, status: 200, json: () => Promise.resolve([]) };
      }
      const body = JSON.parse(init?.body ?? '{}') as Record<string, unknown>;
      bodies.push(body);
      await before?.(bodies.length);
      const said = answer(bodies.length, body);
      // A real Response: a body read twice without a clone would throw, as at a venue.
      return new Response(JSON.stringify(said.body ?? {}), { status: said.status });
    }),
  );
  return { bodies, starts: () => bodies.filter((body) => body['action'] === 'start') };
}

const startOf = async (row: OutboxEntry) =>
  (await db.outbox.get(row.id!)) ??
  (await db.rejected.where('clientUuid').equals(row.clientUuid).first());

const offlineStart = (matchId = 'm1') =>
  addPress('start', matchId, 0, { rulesId: COPY_A, networkStatus: 'offline' });
const onlineStart = (matchId = 'm1') =>
  addPress('start', matchId, 0, { rulesId: COPY_A, networkStatus: 'online' });

describe('at the tap', () => {
  it('a Start tapped on a page that says it is offline: pressed with no network', async () => {
    expect((await offlineStart()).startNetwork).toBe('none');
  });

  it('a Start tapped in the drill: pressed with no network (ruled: the drill counts as none)', async () => {
    startOfflineDrill();
    expect((await onlineStart()).startNetwork).toBe('none');
  });

  it('a Start tapped online: not known yet', async () => {
    expect((await onlineStart()).startNetwork).toBeUndefined();
  });

  it('a Halt holds neither the copy nor the network', async () => {
    const halt = await addPress('halt', 'm1', 0, { rulesId: COPY_A, networkStatus: 'offline' });
    expect(halt.startedUnder).toBeUndefined();
    expect(halt.startNetwork).toBeUndefined();
  });

  // Only the tap could know: its send is answered 200 once the network is back.
  it('keeps the evidence of the tap when its first send is answered', async () => {
    await offlineStart();
    startOfflineDrill();
    const drilled = await onlineStart('m2');
    endOfflineDrill();
    const { starts } = server(() => TAKEN);

    await new SyncEngine(API_URL).drain();

    expect(drilled.startNetwork).toBe('none');
    expect(starts()).toEqual([
      expect.objectContaining({ startedUnder: { rulesId: COPY_A }, pressedWithoutNetwork: true }),
      expect.objectContaining({ startedUnder: { rulesId: COPY_A }, pressedWithoutNetwork: true }),
    ]);
  });
});

describe('at the send', () => {
  it('its own send meets the made-up answer: pressed with no network, said again at every send', async () => {
    const row = await onlineStart();
    server(() => OFFLINE);
    await new SyncEngine(API_URL).drain();

    const after = await startOf(row);
    expect(after?.startNetwork).toBe('none');
    // Filed as no network by the made-up body, not by a send that threw.
    expect(after?.lastError).toBe('offline');

    const { starts } = server(() => TAKEN);
    await new SyncEngine(API_URL).drain();
    expect(starts()[0]).toMatchObject({ pressedWithoutNetwork: true });
  });

  // The hall with wifi and no internet: the page says online, and a pass stops after three rows
  // of the bout before met no network. The Start is never tried.
  it('never tried, behind three rows that met no network: pressed with none, and it stays so', async () => {
    await addHit('m0');
    await addHit('m0');
    await addHit('m0');
    const row = await onlineStart();
    const first = server(() => OFFLINE);
    await new SyncEngine(API_URL).drain();

    expect(first.starts()).toEqual([]);
    expect((await startOf(row))?.startNetwork).toBe('none');

    const { starts } = server((_n, body) => (body['action'] ? TAKEN : SAVED));
    await new SyncEngine(API_URL).drain();
    expect(starts()[0]).toMatchObject({ pressedWithoutNetwork: true });
    expect(await db.outbox.count()).toBe(0);
  });

  it('a walked pass that met no network and no answer: the Starts it listed', async () => {
    // The Start waits behind its bout's hit that met no network: never tried, the pass walks on.
    await addHit('m1');
    const row = await onlineStart();
    server(() => OFFLINE);
    await new SyncEngine(API_URL).drain();

    expect((await startOf(row))?.startNetwork).toBe('none');
  });

  it('a walked pass that met no network, while another send was asked: judged all the same', async () => {
    await addHit('m1');
    await onlineStart();
    const engine = new SyncEngine(API_URL);
    // The first pass sends the hit only (the Start waits behind it) and meets no network; a tap
    // during it asks for another pass, which finds the network back and sends both.
    const { starts } = server(
      (nth, body) => (nth === 1 ? OFFLINE : body['action'] ? TAKEN : SAVED),
      async (nth) => {
        if (nth === 1) void engine.drain();
      },
    );
    await engine.drain();

    expect(starts()).toEqual([expect.objectContaining({ pressedWithoutNetwork: true })]);
  });

  it('a Start tapped while a pass runs that then stops with no network: pressed with none', async () => {
    await addHit('m0');
    await addHit('m0');
    await addHit('m0');
    let tapped: Promise<OutboxEntry> | null = null;
    server(
      () => OFFLINE,
      async (nth) => {
        if (nth === 1) {
          tapped = onlineStart();
          await tapped;
        }
      },
    );
    await new SyncEngine(API_URL).drain();

    expect((await startOf(await tapped!))?.startNetwork).toBe('none');
  });

  it('a walked pass that met no network at all (only a held row): not judged', async () => {
    const held = await addHit('m1');
    await quarantine(held, 'refused');
    const row = await onlineStart();
    server(() => TAKEN);
    await new SyncEngine(API_URL).drain();

    expect((await startOf(row))?.startNetwork).toBeUndefined();
  });
});

describe('a real answer: a network was there', () => {
  it('its own send answered 500: seen, and a later pass with no network changes nothing', async () => {
    const row = await onlineStart();
    server(() => ({ status: 500, body: { message: 'boom' } }));
    await new SyncEngine(API_URL).drain();
    expect((await startOf(row))?.startNetwork).toBe('seen');

    server(() => OFFLINE);
    await new SyncEngine(API_URL).drain();
    const { starts } = server(() => TAKEN);
    await new SyncEngine(API_URL).drain();

    expect((await startOf(row))?.startNetwork).toBeUndefined(); // sent: gone from the queue
    expect(starts()[0]).not.toHaveProperty('pressedWithoutNetwork');
    expect(starts()[0]).toMatchObject({ startedUnder: { rulesId: COPY_A } });
  });

  it('behind its bout’s hit answered 500, never tried: seen from the hit’s answer', async () => {
    await addHit('m1');
    const row = await onlineStart();
    const { starts } = server(() => ({ status: 500, body: {} }));
    await new SyncEngine(API_URL).drain();

    expect(starts()).toEqual([]);
    expect((await startOf(row))?.startNetwork).toBe('seen');
  });

  it('behind another bout’s row answered 401: seen', async () => {
    await addHit('m0');
    const row = await onlineStart();
    server(() => ({ status: 401, body: {} }));
    await new SyncEngine(API_URL).drain();

    expect((await startOf(row))?.startNetwork).toBe('seen');
  });

  it('an edge 503 with no marker is an answer (ruling L): seen', async () => {
    const row = await onlineStart();
    server(() => ({ status: 503, body: {} }));
    await new SyncEngine(API_URL).drain();

    expect((await startOf(row))?.startNetwork).toBe('seen');
  });

  // Written before the filing: `quarantine` copies the stored row, Retry brings it back whole.
  it('answered 400 and held: seen, through the inbox and back', async () => {
    const row = await onlineStart();
    server(() => ({ status: 400, body: { message: 'locked', code: 'match_locked' } }));
    await new SyncEngine(API_URL).drain();
    expect((await db.rejected.toArray())[0]?.startNetwork).toBe('seen');

    expect(await requeueRejected()).toBe(1);
    const back = await db.outbox.where('clientUuid').equals(row.clientUuid).first();
    expect(back?.startNetwork).toBe('seen');
  });

  it('answered 200 and the store fails after: seen, never pressed with none', async () => {
    const row = await onlineStart();
    server(() => TAKEN);
    vi.spyOn(db.outbox, 'delete').mockRejectedValue(new Error('store refused'));
    await new SyncEngine(API_URL).drain();

    expect((await db.outbox.get(row.id!))?.startNetwork).toBe('seen');
  });
});

describe('the body', () => {
  it('names no copy for rules kept with no id, and then sends no evidence either', async () => {
    await addPress('start', 'm1', 0, { networkStatus: 'offline' });
    const { starts } = server(() => TAKEN);
    await new SyncEngine(API_URL).drain();

    expect(starts()[0]).not.toHaveProperty('startedUnder');
    expect(starts()[0]).not.toHaveProperty('pressedWithoutNetwork');
  });
});

describe('the bouts whose Start the server has not taken, and may keep on its copy', () => {
  it('a Start queued, and a Start held in the inbox, by the copy each names; not a Halt', async () => {
    await onlineStart('m1');
    const held = await offlineStart('m2');
    await quarantine(held.id!, 'refused');
    await addPress('halt', 'm3', 0, { rulesId: COPY_A, networkStatus: 'offline' });

    expect(await unsentStarts()).toEqual(
      new Map([
        ['m1', COPY_A],
        ['m2', COPY_A],
      ]),
    );
  });

  // Each takes the copy of now when it lands: holding the screen on the old one would be wrong.
  it('not a Start that met a network after its tap, nor one that names no copy', async () => {
    const seen = await onlineStart('m1');
    await db.outbox.update(seen.id!, { startNetwork: 'seen' });
    await addPress('start', 'm2', 0, { networkStatus: 'offline' });

    expect(await unsentStarts()).toEqual(new Map());
  });
});
