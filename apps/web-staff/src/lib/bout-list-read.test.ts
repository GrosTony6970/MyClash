import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../offline/db';
import { offlineResponse } from '../offline/failure-kind';
import { keepList, keptList } from '../offline/kept-bout';
import { listAfterRead, readBoutList, type ShownList } from './bout-list-read';

interface Row {
  id: string;
}

const HIT: Row = { id: 'hit-1' };
const LATER: Row = { id: 'hit-2' };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const answers = (response: () => Response) =>
  vi.fn(async () => response()) as unknown as typeof fetch;
const read = (fetchFn: typeof fetch, list: 'exchanges' | 'penalties' = 'exchanges') =>
  readBoutList<Row>('http://api', 'bout-1', list, undefined, fetchFn);

beforeEach(async () => {
  await db.reads.clear();
});

describe('one read of a list of a bout', () => {
  it('asks the list’s own route, with the session', async () => {
    const fetchFn = answers(() => json([HIT]));

    await read(fetchFn, 'penalties');

    expect(fetchFn).toHaveBeenCalledWith('http://api/api/v1/matches/bout-1/penalties', {
      credentials: 'include',
      signal: undefined,
    });
  });

  it('gives the server’s rows, and keeps them on the tablet', async () => {
    expect(await read(answers(() => json([HIT])))).toEqual({ kind: 'server', rows: [HIT] });

    // The write is not waited for: a slow store must not hold the screen.
    await vi.waitFor(async () => expect(await keptList('bout-1', 'exchanges')).toEqual([HIT]));
  });

  it('keeps an empty list too: the newest answer of the server replaces the copy', async () => {
    await keepList('bout-1', 'exchanges', [HIT]);

    await read(answers(() => json([])));

    await vi.waitFor(async () => expect(await keptList('bout-1', 'exchanges')).toEqual([]));
  });

  it('with no network, gives the rows the tablet kept', async () => {
    await keepList('bout-1', 'exchanges', [HIT]);

    expect(await read(answers(offlineResponse))).toEqual({ kind: 'tablet', rows: [HIT] });
  });

  it('with no answer at all, gives the rows the tablet kept', async () => {
    await keepList('bout-1', 'exchanges', [HIT]);
    const dead = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;

    expect(await read(dead)).toEqual({ kind: 'tablet', rows: [HIT] });
  });

  it('with no network and no copy, says it knows nothing', async () => {
    expect(await read(answers(offlineResponse))).toEqual({ kind: 'unreachable' });
  });

  it('does not give the hits for the cards', async () => {
    await keepList('bout-1', 'exchanges', [HIT]);

    expect(await read(answers(offlineResponse), 'penalties')).toEqual({ kind: 'unreachable' });
  });

  it('on a server fault, opens no copy and removes none', async () => {
    await keepList('bout-1', 'exchanges', [HIT]);

    expect(await read(answers(() => json({}, 500)))).toEqual({ kind: 'failed', status: 500 });

    expect(await keptList('bout-1', 'exchanges')).toEqual([HIT]);
  });

  it('still gives the server’s rows when the tablet’s store refuses the write', async () => {
    const put = vi.spyOn(db.reads, 'put').mockRejectedValueOnce(new Error('quota'));

    expect(await read(answers(() => json([HIT])))).toEqual({ kind: 'server', rows: [HIT] });

    put.mockRestore();
  });
});

describe('the list on screen after a read', () => {
  const server: ShownList<Row> = { matchId: 'bout-1', rows: [LATER], fromServer: true };
  const tablet: ShownList<Row> = { matchId: 'bout-1', rows: [HIT], fromServer: false };

  it('is the server’s rows', () => {
    expect(listAfterRead(tablet, 'bout-1', { kind: 'server', rows: [LATER] })).toEqual(server);
  });

  it('is the tablet’s rows while the server gave none for this bout', () => {
    expect(listAfterRead(null, 'bout-1', { kind: 'tablet', rows: [HIT] })).toEqual(tablet);
  });

  it('stays the server’s rows when the tablet’s copy lands after them', () => {
    expect(listAfterRead(server, 'bout-1', { kind: 'tablet', rows: [HIT] })).toBe(server);
  });

  it('is the tablet’s rows of THIS bout over the server’s rows of the bout before', () => {
    const before: ShownList<Row> = { matchId: 'bout-0', rows: [LATER], fromServer: true };

    expect(listAfterRead(before, 'bout-1', { kind: 'tablet', rows: [HIT] })).toEqual(tablet);
  });

  it('does not change on a read that knows nothing', () => {
    expect(listAfterRead(server, 'bout-1', { kind: 'unreachable' })).toBe(server);
    expect(listAfterRead(tablet, 'bout-1', { kind: 'failed', status: 500 })).toBe(tablet);
  });
});
