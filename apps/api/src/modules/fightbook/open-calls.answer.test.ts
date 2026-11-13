import { describe, expect, it, vi } from 'vitest';
import {
  filtersFor,
  mockSupabase,
  scopedTo,
  selectsFor,
  writesTo,
  type SupabaseChain,
} from '../../common/testing/supabase-chain';
import {
  ACCOUNT_OF,
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
    [
      'a call of an Event I am not on',
      { calls: [callRow()], rosterOf: [JULIE, PAUL] },
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

describe('OpenCallsService.takeBack', () => {
  it('deletes my answer on an open call, and no one else’s', async () => {
    const { open, supabase } = world({ calls: [callRow()], answers: [answerRow(CALL, MARC)] });
    await open.takeBack(MARC, CALL, NOW);
    const [write] = writesTo(supabase, 'spar_open_call_answers');
    expect(write?.op).toBe('delete');
    expect(scopedTo(write, 'call_id')).toBe(CALL);
    expect(scopedTo(write, 'answerer_global_person_id')).toBe(MARC);
  });

  it('is quiet when there is no answer to take back (two taps)', async () => {
    const { open } = world({ calls: [callRow()] });
    await expect(open.takeBack(MARC, CALL, NOW)).resolves.toBeUndefined();
  });

  it.each<[string, World, Date, [number, string | undefined]]>([
    ['an unknown call', { calls: [] }, NOW, [404, undefined]],
    [
      'a call whose poster I blocked',
      { calls: [callRow()], blocks: [blockRow(MARC, JULIE)] },
      NOW,
      [404, undefined],
    ],
    ['a call past its time', { calls: [callRow()] }, LATE, [409, 'not_open']],
    [
      'a picked call',
      { calls: [callRow({ status: 'picked', picked_global_person_id: PAUL })] },
      NOW,
      [409, 'not_open'],
    ],
  ])('refuses %s, and deletes nothing', async (_, w, now, answer) => {
    const { open, supabase } = world(w);
    expect(await codeOf(open.takeBack(MARC, CALL, now))).toEqual(answer);
    expect(writesTo(supabase, 'spar_open_call_answers')).toEqual([]);
  });
});
