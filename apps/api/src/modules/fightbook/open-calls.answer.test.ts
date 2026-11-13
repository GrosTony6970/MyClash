import type { HttpException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { lastFunctionParams } from '../../common/testing/migration-function';
import {
  filtersFor,
  mockSupabase,
  selectsFor,
  writesTo,
  type SupabaseChain,
} from '../../common/testing/supabase-chain';
import {
  ACCOUNT_OF,
  DRAFT_EVENT,
  JULIE,
  MARC,
  NOW,
  PAUL,
  answerRow,
  blockRow,
  callRow,
  codeOf,
  profile,
  settle,
  withNoticeDeps,
  world,
  type World,
} from './open-calls.fixtures';
import type { SparNoticeDeps } from './spar-notices';

const CALL = callRow().id as string;
const LATE = new Date('2026-05-23T19:00:00Z'); // the call's own time: no longer open

/** A refusal's whole face: its status and its body. */
async function refusalOf(promise: Promise<unknown>) {
  const error = (await promise.catch((e: unknown) => e)) as HttpException;
  return [error.getStatus(), error.getResponse()];
}

/** The options the answer's upsert was sent with (the double records the row, not these). */
function upsertOptions(supabase: ReturnType<typeof world>['supabase']) {
  const index = supabase.from.mock.calls.findIndex(([t]) => t === 'spar_open_call_answers');
  const chain = supabase.from.mock.results[index]?.value as SupabaseChain;
  return chain.upsert.mock.calls[0]?.[1];
}

describe('OpenCallsService.answer: "I\'m in"', () => {
  it('answers an open call once, however many taps', async () => {
    const { open, supabase } = world({ calls: [callRow()] });
    await expect(open.answer(MARC, CALL, NOW)).resolves.toBeUndefined();
    const [write] = writesTo(supabase, 'spar_open_call_answers');
    expect(write?.op).toBe('upsert');
    expect(write?.row).toEqual({ call_id: CALL, answerer_global_person_id: MARC });
    expect(upsertOptions(supabase)).toEqual({
      onConflict: 'call_id,answerer_global_person_id',
      ignoreDuplicates: true,
    });
    expect(selectsFor(supabase.from, 'spar_open_calls')).toEqual([
      'poster_global_person_id, event_id, status, closes_at',
    ]);
    expect(filtersFor(supabase.from, 'spar_open_calls', 'eq')).toEqual([['id', CALL]]);
    expect(filtersFor(supabase.from, 'persons', 'eq')).toEqual([
      ['event_id', callRow().event_id],
      ['global_person_id', MARC],
    ]);
  });

  it.each<[string, World, [number, string | undefined]]>([
    ['an unknown call', { calls: [] }, [404, undefined]],
    [
      'a call whose poster I blocked',
      { calls: [callRow()], blocks: [blockRow(MARC, JULIE)] },
      [404, undefined],
    ],
    [
      'a call whose poster switched off',
      { calls: [callRow()], profiles: [profile(MARC, 'Marc'), profile(JULIE, 'Julie', false)] },
      [404, undefined],
    ],
    ['my own call', { calls: [callRow({ poster_global_person_id: MARC })] }, [400, 'self']],
    // Decision 7: a call the caller cannot see answers 404, as an unknown one does.
    [
      'a call of an Event I am not on',
      { calls: [callRow()], rosterOf: [JULIE, PAUL] },
      [404, undefined],
    ],
    // The read refuses an Event no longer public: so does an answer from an old screen.
    [
      'a call of an Event turned draft',
      { calls: [callRow({ event_id: DRAFT_EVENT })] },
      [400, 'bad_event'],
    ],
    ['a closed call', { calls: [callRow({ status: 'closed' })] }, [409, 'not_open']],
    [
      'a picked call',
      { calls: [callRow({ status: 'picked', picked_global_person_id: PAUL })] },
      [409, 'not_open'],
    ],
  ])('refuses %s, and writes nothing', async (_, w, answer) => {
    const { open, supabase, send } = world(w);
    expect(await codeOf(open.answer(MARC, CALL, NOW))).toEqual(answer);
    expect(writesTo(supabase, 'spar_open_call_answers')).toEqual([]);
    await settle();
    expect(send).not.toHaveBeenCalled();
  });

  it('refuses a call past its time: not_open', async () => {
    const { open } = world({ calls: [callRow()] });
    expect(await codeOf(open.answer(MARC, CALL, LATE))).toEqual([409, 'not_open']);
  });

  it.each(['answer', 'takeBack'] as const)(
    '%s off the roster answers exactly as an unknown call: nothing says the call exists',
    async (route) => {
      const offRoster = world({ calls: [callRow()], rosterOf: [JULIE, PAUL] });
      const unknown = world({ calls: [] });
      const run = (w: typeof unknown) =>
        route === 'answer' ? w.open.answer(MARC, CALL, NOW) : w.open.takeBack(MARC, CALL);
      expect(await refusalOf(run(offRoster))).toEqual(await refusalOf(run(unknown)));
    },
  );

  it('tells the poster "someone is in", about the call', async () => {
    const { open, send } = world({ calls: [callRow()] });
    await open.answer(MARC, CALL, NOW);
    await settle();
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'spar_call_answered',
        entityId: CALL,
        userId: ACCOUNT_OF[JULIE],
      }),
    );
  });
});

describe('OpenCallsService.answer: ruling 672, the poster blocked the answerer', () => {
  it('answers Marc the same way, writes the same row, and tells Julie nothing', async () => {
    const plain = world({ calls: [callRow()] });
    const blocked = world({ calls: [callRow()], blocks: [blockRow(JULIE, MARC)] });
    const outcome = async (w: typeof plain) => {
      const answered = await w.open.answer(MARC, CALL, NOW).then(
        (value) => ({ ok: value }),
        (error: unknown) => ({ error }),
      );
      return { answered, writes: writesTo(w.supabase, 'spar_open_call_answers') };
    };
    expect(await outcome(blocked)).toEqual(await outcome(plain));
    await settle();
    expect(plain.send).toHaveBeenCalledTimes(1);
    expect(blocked.send).not.toHaveBeenCalled();
  });

  it('reads only the caller’s own blocks; Julie’s is read inside the notice', async () => {
    const { open, supabase } = world({ calls: [callRow()], blocks: [blockRow(JULIE, MARC)] });
    const notices = mockSupabase({ fightbook_blocks: { rows: [blockRow(JULIE, MARC)] } });
    const deps = {
      db: notices.service,
      notifications: { sendImmediate: vi.fn() },
      supabase: { getAuthAdminUser: vi.fn() },
      logger: { warn: vi.fn(), error: vi.fn() },
    } as unknown as SparNoticeDeps;
    await withNoticeDeps(open, deps).answer(MARC, CALL, NOW);
    expect(filtersFor(supabase.from, 'fightbook_blocks', 'eq')).toEqual([
      ['blocker_global_person_id', MARC],
    ]);
    expect(filtersFor(notices.from, 'fightbook_blocks', 'eq')).toEqual([
      ['blocker_global_person_id', JULIE],
      ['blocked_global_person_id', MARC],
    ]);
  });

  it('answers before the notice settles: the block read inside it never holds the answer', async () => {
    const { open } = world({ calls: [callRow()] });
    const hangs = new Promise(() => undefined);
    const chain = {
      select: () => chain,
      eq: () => chain,
      limit: () => hangs,
      maybeSingle: () => hangs,
    };
    const from = vi.fn(() => chain);
    const deps = {
      db: { from },
      notifications: { sendImmediate: vi.fn() },
      supabase: { getAuthAdminUser: vi.fn() },
      logger: { warn: vi.fn(), error: vi.fn() },
    } as unknown as SparNoticeDeps;
    const answered = await Promise.race([
      withNoticeDeps(open, deps)
        .answer(MARC, CALL, NOW)
        .then(() => 'answered'),
      new Promise((resolve) => setTimeout(() => resolve('waited'), 50)),
    ]);
    expect(answered).toBe('answered');
    // The notice really was under way, at its block read, which never settles.
    expect(from).toHaveBeenCalledWith('fightbook_blocks');
  });
});

// Ruling M: a take-back is authorized by the caller's own answer row. A row proves he already
// knew the call, so nothing he is told is new; no row reads exactly as an unknown call.
describe('OpenCallsService.takeBack', () => {
  const MINE = answerRow(CALL, MARC);

  it('takes back my answer in one database call, which reads the call after it locks the answer', async () => {
    const { open, supabase } = world({ calls: [callRow()], answers: [MINE] });
    await expect(open.takeBack(MARC, CALL)).resolves.toBeUndefined();
    expect(supabase.rpc.mock.calls.map(([name]) => name)).toEqual(['fightbook_call_take_back']);
    const args = supabase.rpc.mock.calls[0]?.[1];
    expect(Object.keys(args ?? {})).toEqual(lastFunctionParams('fightbook_call_take_back'));
    expect(args).toEqual({ p_call: CALL, p_answerer: MARC });
    // The SQL decides the call's state: no read or write of the API's own can race a pick.
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('works for an answerer taken off the roster: removing presence is always allowed', async () => {
    const { open } = world({ calls: [callRow()], answers: [MINE], rosterOf: [JULIE] });
    await expect(open.takeBack(MARC, CALL)).resolves.toBeUndefined();
  });

  it('with no answer of mine on a real call, reads exactly as an unknown call', async () => {
    const real = world({ calls: [callRow()], answers: [answerRow(CALL, PAUL)] });
    const unknown = world({ calls: [] });
    expect(await refusalOf(real.open.takeBack(MARC, CALL))).toEqual(
      await refusalOf(unknown.open.takeBack(MARC, CALL)),
    );
  });

  it.each<[string, World, [number, string | undefined]]>([
    ['an unknown call', { calls: [] }, [404, undefined]],
    ['a call I never answered (a second tap)', { calls: [callRow()] }, [404, undefined]],
    [
      'a call past its time',
      { calls: [callRow()], answers: [MINE], dbNow: LATE },
      [409, 'not_open'],
    ],
    [
      'a picked call (a pick that won the race included)',
      {
        calls: [callRow({ status: 'picked', picked_global_person_id: MARC })],
        answers: [MINE],
      },
      [409, 'not_open'],
    ],
  ])('refuses %s', async (_, w, answer) => {
    const { open } = world(w);
    expect(await codeOf(open.takeBack(MARC, CALL))).toEqual(answer);
  });

  it('answers a refused take-back with a sentence, not the database word', async () => {
    const { open } = world({ calls: [callRow()], answers: [MINE], dbNow: LATE });
    expect(await refusalOf(open.takeBack(MARC, CALL))).toEqual([
      409,
      { code: 'not_open', message: 'This request is no longer open' },
    ]);
  });

  it('turns any other database error into a 5xx', async () => {
    const { open, supabase } = world({ calls: [callRow()], answers: [MINE] });
    supabase.rpc.mockResolvedValueOnce({ data: null, error: { code: 'XX000', message: 'boom' } });
    await expect(open.takeBack(MARC, CALL)).rejects.toThrow('boom');
  });

  it('ruling 672: Marc takes back the same way whether Julie blocked him or not', async () => {
    const base: World = { calls: [callRow()], answers: [answerRow(CALL, MARC)] };
    const outcome = async (w: World) => {
      const { open, supabase } = world(w);
      const taken = await open.takeBack(MARC, CALL).then(
        (value) => ({ ok: value }),
        (error: unknown) => ({ error }),
      );
      return { taken, calls: supabase.rpc.mock.calls };
    };
    const plain = await outcome(base);
    expect(await outcome({ ...base, blocks: [blockRow(JULIE, MARC)] })).toEqual(plain);
    expect(plain.taken).toEqual({ ok: undefined });
  });
});
