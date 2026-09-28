/**
 * `GET /events/:eventId/programme` and `/programme/config` (ruling 129, the bar of rulings 81-83
 * and 127): a draft Tournament's bars and its planner-sheet row are left out for anyone but a
 * member of the Event's club or an ACTIVE staff session of the same Event — exactly as if the
 * Tournament did not exist. The membership and staff checks run for real over seeded tables.
 */
import 'reflect-metadata';
import { HttpException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  filtersFor,
  mockSupabase,
  queriedTables,
  selectsFor,
  type TableSeed,
} from '../../common/testing/supabase-chain';
import { OrganizationsService } from '../organizations/organizations.service';
import { PROGRAMME_CONFIG_DEFAULTS } from './dto/programme.dto';
import { ProgrammeController } from './programme.controller';
import { ProgrammeService } from './programme.service';

const EVENT = { id: 'e1', status: 'published', organization_id: 'org-a', event_kind: 'standard' };
// The sheet's schema takes a Tournament id only as a uuid.
const T_OPEN = '11111111-1111-4111-8111-111111111111';
const T_SECRET = '22222222-2222-4222-8222-222222222222';
const OPEN = { id: T_OPEN, event_id: 'e1', status: 'published' };
const SECRET = { id: T_SECRET, event_id: 'e1', status: 'draft' };

const bar = (id: string, competitionId: string | null, label: string) => ({
  id,
  event_id: 'e1',
  day_index: 0,
  sort_order: 0,
  block_type: competitionId ? 'competition' : 'admin',
  label,
  competition_id: competitionId,
  competition_phase: competitionId ? 'pool' : null,
  workshop_id: null,
  lice_count: competitionId ? 2 : 0,
  start_time: '09:00:00',
  end_time: '10:00:00',
  color_hex: null,
  generated_at: null,
});
const REGISTRATION = bar('b-admin', null, 'Registration');
const OPEN_POOLS = bar('b-open', T_OPEN, 'Sabre Cup — Pools');
const SECRET_POOLS = bar('b-secret', T_SECRET, 'Longsword Open — Pools');

const SHEET = {
  event_id: 'e1',
  config_json: {
    tournaments: [
      { tournamentId: T_OPEN, poolMatchDurationMinutes: 6 },
      { tournamentId: T_SECRET, poolMatchDurationMinutes: 9 },
    ],
  },
};

let db: ReturnType<typeof mockSupabase>;

function seed(tables: Partial<Record<string, TableSeed>> = {}) {
  db = mockSupabase({
    events: { rows: [EVENT] },
    tournaments: { rows: [OPEN, SECRET] },
    event_programme_blocks: { rows: [REGISTRATION, OPEN_POOLS, SECRET_POOLS] },
    event_programme_configs: { rows: [SHEET] },
    organization_members: {
      rows: [
        { organization_id: 'org-a', user_id: 'u-member', role: 'read_only' },
        { organization_id: 'org-b', user_id: 'u-owner-b', role: 'owner' },
      ],
    },
    event_staff_accounts: {
      rows: [
        { id: 'staff-e1', event_id: 'e1', status: 'active' },
        { id: 'staff-off', event_id: 'e1', status: 'disabled' },
        { id: 'staff-e2', event_id: 'e2', status: 'active' },
      ],
    },
    ...tables,
  } as Record<string, TableSeed>);
}

function controller() {
  const supabase = { service: db.service };
  const orgs = new OrganizationsService(supabase as never);
  const service = new ProgrammeService(supabase as never, orgs, {} as never);
  return new ProgrammeController(service, supabase as never);
}

const claimed = (userId: string) => ({ identity: { kind: 'claimed', userId, email: null } });
const staffOf = (staffId: string, eventId: string) => ({ staffSession: { staffId, eventId } });
const bars = async (req: object = {}) =>
  (await controller().listBlocks('e1', req as never)).map((block) => block.id);
const sheetRows = async (req: object = {}) =>
  (await controller().getConfig('e1', req as never)).tournaments.map((row) => row.tournamentId);

const ALL_BARS = ['b-admin', 'b-open', 'b-secret'];
const PUBLIC_BARS = ['b-admin', 'b-open'];

beforeEach(() => seed());

describe('the programme and its sheet leave a draft Tournament out for outsiders (ruling 129)', () => {
  it('shows a signed-out visitor only the published Tournament, reading its status', async () => {
    expect(await bars()).toEqual(PUBLIC_BARS);
    expect(await sheetRows()).toEqual([T_OPEN]);
    expect(selectsFor(db.from, 'events')).toEqual([
      'status, organization_id, event_kind',
      'status, organization_id, event_kind',
    ]);
    expect(selectsFor(db.from, 'tournaments')).toEqual(['id, status', 'id, status']);
    expect(filtersFor(db.from, 'tournaments', 'eq')).toEqual([
      ['event_id', 'e1'],
      ['event_id', 'e1'],
    ]);
    expect(selectsFor(db.from, 'event_programme_blocks')).toEqual(['*']);
    expect(selectsFor(db.from, 'event_programme_configs')).toEqual(['config_json']);
    // A signed-out visitor costs no membership read.
    expect(queriedTables(db.from)).not.toContain('organization_members');
  });

  it.each([
    ['a member of another club', claimed('u-owner-b')],
    ["another Event's staff", staffOf('staff-e2', 'e2')],
    ['a disabled staff session', staffOf('staff-off', 'e1')],
  ])('shows %s only the published Tournament', async (_who, req) => {
    expect(await bars(req)).toEqual(PUBLIC_BARS);
    expect(await sheetRows(req)).toEqual([T_OPEN]);
  });

  it.each([
    ["a member of the Event's club", claimed('u-member')],
    ["the Event's active staff session", staffOf('staff-e1', 'e1')],
  ])('shows %s the draft too', async (_who, req) => {
    expect(await bars(req)).toEqual(ALL_BARS);
    expect(await sheetRows(req)).toEqual([T_OPEN, T_SECRET]);
  });

  it('answers a draft-only Event exactly as an Event with no Tournament', async () => {
    seed({
      tournaments: { rows: [SECRET] },
      event_programme_blocks: { rows: [REGISTRATION, SECRET_POOLS] },
      event_programme_configs: {
        rows: [
          { event_id: 'e1', config_json: { tournaments: [SHEET.config_json.tournaments[1]] } },
        ],
      },
    });
    const draftOnly = [await bars(), await controller().getConfig('e1', {} as never)];
    seed({
      tournaments: { rows: [] },
      event_programme_blocks: { rows: [REGISTRATION] },
      event_programme_configs: { rows: [{ event_id: 'e1', config_json: { tournaments: [] } }] },
    });
    expect(draftOnly).toEqual([await bars(), await controller().getConfig('e1', {} as never)]);
  });

  it.each([
    ['a draft Event', { status: 'draft' }],
    ['a test Event', { event_kind: 'test' }],
  ])('keeps %s hidden: 404 in the unknown-Event words, nothing else read', async (_e, change) => {
    seed({ events: { rows: [{ ...EVENT, ...change }] } });
    for (const read of [() => bars(), () => sheetRows()]) {
      const failure = await read().catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(NotFoundException);
      expect((failure as Error).message).toBe('Event "e1" not found');
    }
    expect(new Set(queriedTables(db.from))).toEqual(new Set(['events']));
  });

  it('answers an unknown Event as before: no bars, the default sheet', async () => {
    seed({
      events: { rows: [] },
      event_programme_blocks: { rows: [] },
      event_programme_configs: { rows: [] },
    });
    expect(await bars()).toEqual([]);
    expect(await controller().getConfig('e1', {} as never)).toEqual(PROGRAMME_CONFIG_DEFAULTS);
  });

  it('fails a failed Event or Tournament read as a 5xx, never as "nothing hidden"', async () => {
    for (const table of ['events', 'tournaments']) {
      for (const read of [() => bars(), () => sheetRows()]) {
        seed({ [table]: { data: null, error: { message: 'connection reset' } } });
        const failure = await read().catch((error: unknown) => error);
        expect(failure, table).toBeInstanceOf(Error);
        expect(failure, table).not.toBeInstanceOf(HttpException);
      }
    }
  });
});
