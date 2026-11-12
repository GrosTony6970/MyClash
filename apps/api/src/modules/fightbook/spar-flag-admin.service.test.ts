import { NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { lastFunctionParams } from '../../common/testing/migration-function';
import {
  filtersFor,
  mockSupabase,
  queriedTables,
  selectsFor,
  type ChainResult,
} from '../../common/testing/supabase-chain';
import { SparFlagAdminService } from './spar-flag-admin.service';

const ADMIN = '9a000000-0000-4000-8000-000000000001';
const ORG = 'bb000000-0000-4000-8000-00000000000a';
const OTHER_ORG = 'bb000000-0000-4000-8000-00000000000b';
const MARC = '0b9c3a52-7d59-4a57-9f55-1b1f3f5c2a01';
const JULIE = '1c8d4b63-8e6a-4b68-8a66-2c2a4a6d3b12';
const PAUL = '2d9e5c74-9f7b-4c79-9b77-3d3b5b7e4c23';
const EVENT = 'eeeeeeee-0000-4000-8000-00000000000a';
const OTHER_EVENT = 'eeeeeeee-0000-4000-8000-00000000000b';
const FLAG = '7f000000-0000-4000-8000-00000000000f';
const NOW = new Date('2026-06-01T09:00:00Z');

const person = (id: string, name: string) => ({
  id,
  display_name: name,
  given_name: null,
  family_name: null,
  photo_url: null,
  clubs: { name: `${name} Club` },
});

const flagRow = (n: number, over: Record<string, unknown> = {}) => ({
  id: `7f000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  created_at: '2026-05-30T10:00:00Z',
  reason: 'equipment',
  body: 'A cracked mask',
  reporter_global_person_id: JULIE,
  subject_global_person_id: MARC,
  kind: 'event',
  event_id: EVENT,
  organization_id: ORG,
  spar_day: '2026-05-29',
  place: null,
  weapons: ['longsword'],
  handled_at: null,
  ...over,
});

function setup(rows: Record<string, unknown>[], mark: ChainResult = { data: true, error: null }) {
  const supabase = mockSupabase(
    {
      global_persons: {
        rows: [person(MARC, 'Marc'), person(JULIE, 'Julie'), person(PAUL, 'Paul')],
      },
      events: {
        rows: [
          { id: EVENT, name: 'Probe Open' },
          { id: OTHER_EVENT, name: 'Not on the page' },
        ],
      },
      organizations: {
        rows: [
          { id: ORG, name: 'Probe Club' },
          { id: OTHER_ORG, name: 'Not on the page' },
        ],
      },
    },
    {
      fightbook_flags_page: () => ({ data: rows, error: null }),
      fightbook_flag_mark: () => mark,
    },
  );
  return { service: new SparFlagAdminService(supabase as never), supabase };
}

describe('SparFlagAdminService.page', () => {
  it('asks the function for page 2 of the club, 21 rows from offset 40, with its own keys', async () => {
    const { service, supabase } = setup([]);
    await service.page(ADMIN, ORG, 2);
    const [name, args] = supabase.rpc.mock.calls[0]!;
    expect(name).toBe('fightbook_flags_page');
    expect(args).toEqual({ p_caller: ADMIN, p_org: ORG, p_offset: 40, p_limit: 21 });
    expect(Object.keys(args!).sort()).toEqual(
      [...lastFunctionParams('fightbook_flags_page')].sort(),
    );
  });

  it('passes a null club for the platform list and starts at offset 0', async () => {
    const { service, supabase } = setup([]);
    await service.page(ADMIN, null, 0);
    expect(supabase.rpc.mock.calls[0]![1]).toEqual({
      p_caller: ADMIN,
      p_org: null,
      p_offset: 0,
      p_limit: 21,
    });
  });

  it('shows 20 items and says more when the function answers 21', async () => {
    const rows = Array.from({ length: 21 }, (_, i) => flagRow(i + 1));
    const { service } = setup(rows);
    const page = await service.page(ADMIN, ORG, 0);
    expect(page.items).toHaveLength(20);
    expect(page.more).toBe(true);
    expect(page.items.at(-1)?.id).toBe(rows[19]!.id);
  });

  it('says no more on 20 rows', async () => {
    const { service } = setup(Array.from({ length: 20 }, (_, i) => flagRow(i + 1)));
    const page = await service.page(ADMIN, ORG, 0);
    expect(page.items).toHaveLength(20);
    expect(page.more).toBe(false);
  });

  it('builds the club item: names, Event, text, handled, and no club', async () => {
    const { service } = setup([flagRow(1, { handled_at: '2026-05-31T08:00:00Z' })]);
    const { items } = await service.page(ADMIN, ORG, 0);
    expect(items).toEqual([
      {
        id: flagRow(1).id,
        createdAt: '2026-05-30T10:00:00Z',
        reason: 'equipment',
        text: 'A cracked mask',
        reporter: { globalPersonId: JULIE, name: 'Julie', photoUrl: null, club: 'Julie Club' },
        flagged: { globalPersonId: MARC, name: 'Marc', photoUrl: null, club: 'Marc Club' },
        kind: 'event',
        eventName: 'Probe Open',
        club: null,
        day: '2026-05-29',
        place: null,
        weapons: ['longsword'],
        handled: true,
      },
    ]);
  });

  it('reads only the page’s fighters and Events, and no club on the club list', async () => {
    const { service, supabase } = setup([flagRow(1)]);
    await service.page(ADMIN, ORG, 0);
    expect(filtersFor(supabase.from, 'global_persons', 'in')).toEqual([['id', [MARC, JULIE]]]);
    expect(filtersFor(supabase.from, 'events', 'in')).toEqual([['id', [EVENT]]]);
    expect(queriedTables(supabase.from)).not.toContain('organizations');
  });

  it('answers an erased reporter as null', async () => {
    const { service } = setup([flagRow(1, { reporter_global_person_id: null })]);
    const { items } = await service.page(ADMIN, ORG, 0);
    expect(items[0]!.reporter).toBeNull();
    expect(items[0]!.flagged.name).toBe('Marc');
  });

  it('gives a free spar and an Event since deleted no Event name, and reads no Event', async () => {
    const { service, supabase } = setup([
      flagRow(1, { kind: 'free', event_id: null, place: 'Park' }),
      flagRow(2, { event_id: null }),
    ]);
    const { items } = await service.page(ADMIN, ORG, 0);
    expect(items.map((i) => i.eventName)).toEqual([null, null]);
    expect(items[0]!.place).toBe('Park');
    expect(queriedTables(supabase.from)).not.toContain('events');
  });

  it('fills the platform list’s club from organizations.name, for the page’s clubs only', async () => {
    const { service, supabase } = setup([flagRow(1), flagRow(2, { organization_id: null })]);
    const { items } = await service.page(ADMIN, null, 0);
    expect(items.map((i) => i.club)).toEqual(['Probe Club', null]);
    expect(selectsFor(supabase.from, 'organizations')).toEqual(['id, name']);
    expect(filtersFor(supabase.from, 'organizations', 'in')).toEqual([['id', [ORG]]]);
  });

  it('throws on a failed function, not an empty page', async () => {
    const supabase = mockSupabase(
      {},
      { fightbook_flags_page: () => ({ data: null, error: { message: 'boom' } }) },
    );
    await expect(new SparFlagAdminService(supabase as never).page(ADMIN, ORG, 0)).rejects.toThrow(
      /flags read failed/u,
    );
  });
});

describe('SparFlagAdminService.mark', () => {
  it.each([true, false])(
    'calls fightbook_flag_mark with handled %s and its own keys',
    async (handled) => {
      const { service, supabase } = setup([]);
      await service.mark(ADMIN, ORG, FLAG, handled, NOW);
      const [name, args] = supabase.rpc.mock.calls[0]!;
      expect(name).toBe('fightbook_flag_mark');
      expect(args).toEqual({
        p_caller: ADMIN,
        p_org: ORG,
        p_flag: FLAG,
        p_handled: handled,
        p_now: NOW.toISOString(),
      });
      expect(Object.keys(args!).sort()).toEqual(
        [...lastFunctionParams('fightbook_flag_mark')].sort(),
      );
    },
  );

  it('answers quietly on a repeat: the function says true again', async () => {
    const { service } = setup([]);
    await service.mark(ADMIN, null, FLAG, true, NOW);
    await expect(service.mark(ADMIN, null, FLAG, true, NOW)).resolves.toBeUndefined();
  });

  it('answers 404 when the function says false', async () => {
    const { service } = setup([], { data: false, error: null });
    await expect(service.mark(ADMIN, ORG, FLAG, true, NOW)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('throws on a failed function, which is not a 404', async () => {
    const { service } = setup([], { data: null, error: { message: 'boom' } });
    await expect(service.mark(ADMIN, ORG, FLAG, true, NOW)).rejects.toThrow(/mark failed/u);
  });
});
