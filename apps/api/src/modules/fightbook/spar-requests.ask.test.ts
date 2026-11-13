import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  type HttpException,
} from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { filtersFor, mockSupabase, selectsFor } from '../../common/testing/supabase-chain';
import { sparExpiresAt } from './spar-ask-rules';
import { SparRequestsService, type AskSparInput } from './spar-requests.service';

const MARC = '0b9c3a52-7d59-4a57-9f55-1b1f3f5c2a01';
const JULIE = '1c8d4b63-8e6a-4b68-8a66-2c2a4a6d3b12';
const EVENT = 'eeeeeeee-0000-4000-8000-00000000000a';
const REQUEST = '5b000000-0000-4000-8000-00000000000a';
const NOW = new Date('2026-05-20T10:00:00Z');
const JULIE_ACCOUNT = '9a8b7c6d-1111-4222-8333-944455566677';

const publicEvent = {
  id: EVENT,
  status: 'published',
  event_kind: 'standard',
  start_date: '2026-05-22',
  end_date: '2026-05-24',
  timezone: 'Europe/Paris',
};

function setup({
  event = publicEvent as Record<string, unknown> | null,
  rosterRow = true,
  answer = { data: { id: REQUEST, status: 'pending' }, error: null } as {
    data: unknown;
    error: { code?: string; message: string } | null;
  },
  send = vi.fn(async () => undefined),
} = {}) {
  const supabase = mockSupabase(
    {
      events: { rows: event ? [event] : [] },
      persons: {
        rows: rosterRow ? [{ id: 'p-1', event_id: EVENT, global_person_id: MARC }] : [],
      },
      weapon_catalog: {
        rows: [
          { name: 'Longsword', active: true },
          { name: 'Sabre', active: true },
          { name: 'Rapier', active: false },
        ],
      },
      global_persons: { rows: [{ id: JULIE, claimed_by_user_id: JULIE_ACCOUNT }] },
    },
    { fightbook_ask: () => answer as never },
  );
  const notifications = { sendImmediate: send };
  const getAuthAdminUser = vi.fn(async () => ({
    ok: true,
    status: 200,
    data: { id: JULIE_ACCOUNT, email: 'julie@example.test' },
  }));
  Object.assign(supabase, { getAuthAdminUser });
  const service = new SparRequestsService(supabase as never, notifications as never);
  return { service, supabase, send };
}

const free: AskSparInput = {
  receiverGlobalPersonId: JULIE,
  kind: 'free',
  day: '2026-05-22',
  zone: 'Europe/Paris',
  place: 'Salle Probe',
  weapons: ['longsword '],
};
const atEvent: AskSparInput = {
  receiverGlobalPersonId: JULIE,
  kind: 'event',
  eventId: EVENT,
  day: '2026-05-23',
  time: '18:30',
  weapons: ['Longsword', 'Sabre'],
  message: 'After the Pools?',
};

async function codeOf(promise: Promise<unknown>): Promise<[number, string | undefined]> {
  try {
    await promise;
  } catch (e) {
    const err = e as HttpException;
    return [err.getStatus(), (err.getResponse() as { code?: string }).code];
  }
  return [0, undefined];
}

const rpcArgs = (supabase: ReturnType<typeof setup>['supabase']) =>
  supabase.rpc.mock.calls[0]?.[1] as Record<string, unknown>;

describe('SparRequestsService.ask', () => {
  it('asks for a free date, ending at midnight on the asker’s clock', async () => {
    const { service, supabase } = setup();
    expect(await service.ask(MARC, free, NOW)).toEqual({ id: REQUEST });
    expect(rpcArgs(supabase)).toEqual({
      p_asker: MARC,
      p_receiver: JULIE,
      p_kind: 'free',
      p_event_id: null,
      p_spar_day: '2026-05-22',
      p_zone: 'Europe/Paris',
      p_spar_time: null,
      p_place: 'Salle Probe',
      p_weapons: ['Longsword'],
      p_message: null,
      p_expires_at: sparExpiresAt('free', '2026-05-22', 'Europe/Paris')!.toISOString(),
    });
  });

  it('asks for an Event day on the Event’s own clock', async () => {
    const { service, supabase } = setup();
    await service.ask(MARC, atEvent, NOW);
    expect(rpcArgs(supabase)).toMatchObject({
      p_kind: 'event',
      p_event_id: EVENT,
      p_zone: 'Europe/Paris',
      p_spar_time: '18:30',
      p_place: null,
      p_weapons: ['Longsword', 'Sabre'],
      p_message: 'After the Pools?',
      p_expires_at: '2026-05-24T04:00:00.000Z',
    });
    expect(selectsFor(supabase.from, 'events')).toEqual([
      'id, status, event_kind, start_date, end_date, timezone',
    ]);
    expect(selectsFor(supabase.from, 'persons')).toEqual(['id']);
    expect(filtersFor(supabase.from, 'persons', 'eq')).toEqual([
      ['event_id', EVENT],
      ['global_person_id', MARC],
    ]);
    expect(selectsFor(supabase.from, 'weapon_catalog')).toEqual(['name']);
  });

  it.each([
    ['a test Event', { ...publicEvent, event_kind: 'test' }, true],
    ['a draft Event', { ...publicEvent, status: 'draft' }, true],
    ['an unknown Event', null, true],
    ['an Event the asker is not on', publicEvent, false],
  ])('refuses %s: bad_event (ruling 665)', async (_, event, rosterRow) => {
    const { service, supabase } = setup({ event, rosterRow });
    expect(await codeOf(service.ask(MARC, atEvent, NOW))).toEqual([400, 'bad_event']);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it.each<[string, Partial<AskSparInput>, Date]>([
    ['a day outside the Event', { day: '2026-05-25' }, NOW],
    ['a day already over', { day: '2026-05-22' }, new Date('2026-05-23T05:00:00Z')],
  ])('refuses %s: bad_day', async (_, change, now) => {
    const { service } = setup();
    expect(await codeOf(service.ask(MARC, { ...atEvent, ...change }, now))).toEqual([
      400,
      'bad_day',
    ]);
  });

  it('refuses a free date a day more than a year ahead: bad_day', async () => {
    const { service } = setup();
    expect(await codeOf(service.ask(MARC, { ...free, day: '2027-05-22' }, NOW))).toEqual([
      400,
      'bad_day',
    ]);
  });

  it.each<[string, Partial<AskSparInput>]>([
    ['an unknown zone', { zone: 'Mars/Olympus' }],
    ['no zone', { zone: undefined }],
  ])('refuses a free date with %s: bad_zone', async (_, change) => {
    const { service } = setup();
    expect(await codeOf(service.ask(MARC, { ...free, ...change }, NOW))).toEqual([400, 'bad_zone']);
  });

  it('refuses a free date with no place: bad_place', async () => {
    const { service } = setup();
    expect(await codeOf(service.ask(MARC, { ...free, place: undefined }, NOW))).toEqual([
      400,
      'bad_place',
    ]);
  });

  it('refuses a weapon off the catalog: bad_weapon', async () => {
    const { service } = setup();
    expect(await codeOf(service.ask(MARC, { ...free, weapons: ['Rapier'] }, NOW))).toEqual([
      400,
      'bad_weapon',
    ]);
  });

  it.each([
    ['already_asked', ConflictException, 409],
    ['not_again', ConflictException, 409],
    ['self', BadRequestException, 400],
    // Decision 14: a word the database raises about the request's own shape is a 400, so the
    // status never tells which side refused.
    ['bad_answer', BadRequestException, 400],
    ['bad_code', BadRequestException, 400],
    ['bad_event', BadRequestException, 400],
    ['fightbook_off', ForbiddenException, 403],
    ['not_on_fightbook', ForbiddenException, 403],
    ['you_blocked', ForbiddenException, 403],
  ] as const)('answers the database’s %s with its code', async (word, type, status) => {
    const { service } = setup({ answer: { data: null, error: { code: 'P0001', message: word } } });
    const outcome = service.ask(MARC, free, NOW);
    await expect(outcome).rejects.toBeInstanceOf(type);
    expect(await codeOf(service.ask(MARC, free, NOW))).toEqual([status, word]);
  });

  it('turns any other database error into a 5xx', async () => {
    const { service } = setup({
      answer: { data: null, error: { code: 'XX000', message: 'boom' } },
    });
    await expect(service.ask(MARC, free, NOW)).rejects.toThrow('boom');
  });

  it('tells the fighter asked, once the ask is stored as waiting', async () => {
    const { service, send } = setup();
    await service.ask(MARC, free, NOW);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'spar_request_received',
        entityId: REQUEST,
        userId: JULIE_ACCOUNT,
      }),
    );
  });

  it('answers a blocked ask exactly as any other, and tells nobody', async () => {
    const pending = setup();
    const blocked = setup({
      answer: { data: { id: REQUEST, status: 'not_this_time' }, error: null },
    });
    expect(await blocked.service.ask(MARC, free, NOW)).toEqual(
      await pending.service.ask(MARC, free, NOW),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(blocked.send).not.toHaveBeenCalled();
  });

  it('answers before the notice is sent: a blocked ask, which sends none, is no faster', async () => {
    const never = vi.fn(() => new Promise<undefined>(() => undefined));
    const { service } = setup({ send: never });
    const answered = await Promise.race([
      service.ask(MARC, free, NOW).then(() => 'answered'),
      new Promise((resolve) => setTimeout(() => resolve('waited'), 50)),
    ]);
    expect(answered).toBe('answered');
    // The notice really was under way: the send was reached, and it never settles.
    await vi.waitFor(() => expect(never).toHaveBeenCalled());
  });
});
