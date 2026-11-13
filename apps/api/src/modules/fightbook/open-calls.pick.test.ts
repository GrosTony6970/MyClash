import { ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { lastFunctionParams } from '../../common/testing/migration-function';
import { filtersFor, selectsFor } from '../../common/testing/supabase-chain';
import {
  ACCOUNT_OF,
  DRAFT_EVENT,
  MARC,
  PAUL,
  SPAR,
  TODAY,
  callRow,
  codeOf,
  settle,
  withNoticeDeps,
  world,
} from './open-calls.fixtures';
import type { SparNoticeDeps } from './spar-notices';

const MINE = callRow({ poster_global_person_id: MARC });
const CALL = MINE.id as string;

const pickArgs = (supabase: ReturnType<typeof world>['supabase']) =>
  supabase.rpc.mock.calls[0]?.[1] as Record<string, unknown> | undefined;

describe('OpenCallsService.pick', () => {
  it('agrees the spar in one database call, ending with the Event day, and answers its id', async () => {
    const { open, supabase } = world({ calls: [MINE] });
    expect(await open.pick(MARC, CALL, PAUL)).toEqual({ requestId: SPAR });
    expect(supabase.rpc.mock.calls[0]?.[0]).toBe('fightbook_call_pick');
    expect(Object.keys(pickArgs(supabase) ?? {})).toEqual(
      lastFunctionParams('fightbook_call_pick'),
    );
    expect(pickArgs(supabase)).toEqual({
      p_call: CALL,
      p_poster: MARC,
      p_answerer: PAUL,
      // 06:00 the next morning in New York (ruling 154).
      p_expires_at: '2026-05-24T10:00:00.000Z',
    });
    expect(selectsFor(supabase.from, 'spar_open_calls')).toEqual(['event_id, spar_day, zone']);
    expect(filtersFor(supabase.from, 'spar_open_calls', 'eq')).toEqual([
      ['id', CALL],
      ['poster_global_person_id', MARC],
    ]);
    expect(MINE.spar_day).toBe(TODAY);
  });

  it('tells the fighter picked, about the spar', async () => {
    const { open, send } = world({ calls: [MINE] });
    await open.pick(MARC, CALL, PAUL);
    await settle();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'spar_call_picked',
        entityId: SPAR,
        userId: ACCOUNT_OF[PAUL],
      }),
    );
  });

  it('answers 404 for a call that is not mine, and calls nothing', async () => {
    const { open, supabase } = world({ calls: [callRow()] });
    expect((await codeOf(open.pick(MARC, callRow().id as string, PAUL)))[0]).toBe(404);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('refuses a pick at an Event turned draft, as the read does: bad_event, and calls nothing', async () => {
    const { open, supabase } = world({ calls: [{ ...MINE, event_id: DRAFT_EVENT }] });
    expect(await codeOf(open.pick(MARC, CALL, PAUL))).toEqual([400, 'bad_event']);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('answers the database’s not_open as 409, and tells nobody', async () => {
    const refused = { data: null, error: { code: 'P0001', message: 'not_open' } };
    const { open, send } = world({ calls: [MINE], pick: refused as never });
    const outcome = open.pick(MARC, CALL, PAUL);
    await expect(outcome).rejects.toBeInstanceOf(ConflictException);
    expect(await codeOf(open.pick(MARC, CALL, PAUL))).toEqual([409, 'not_open']);
    await settle();
    expect(send).not.toHaveBeenCalled();
  });

  it('turns any other database error into a 5xx', async () => {
    const broken = { data: null, error: { code: 'XX000', message: 'boom' } };
    const { open } = world({ calls: [MINE], pick: broken as never });
    await expect(open.pick(MARC, CALL, PAUL)).rejects.toThrow('boom');
  });

  it('answers before the notice settles', async () => {
    const { open } = world({ calls: [MINE] });
    const hangs = new Promise(() => undefined);
    const chain = { select: () => chain, eq: () => chain, maybeSingle: () => hangs };
    const from = vi.fn(() => chain);
    const deps = {
      db: { from },
      notifications: { sendImmediate: vi.fn() },
      supabase: { getAuthAdminUser: vi.fn() },
      logger: { warn: vi.fn(), error: vi.fn() },
    } as unknown as SparNoticeDeps;
    const answered = await Promise.race([
      withNoticeDeps(open, deps)
        .pick(MARC, CALL, PAUL)
        .then(() => 'answered'),
      new Promise((resolve) => setTimeout(() => resolve('waited'), 50)),
    ]);
    expect(answered).toBe('answered');
    expect(from).toHaveBeenCalledWith('global_persons');
  });
});
