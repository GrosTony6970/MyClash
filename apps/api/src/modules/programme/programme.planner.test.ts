/**
 * `GET /events/:eventId/programme/planner/blocks` and `/planner/sheet` (ruling 166b): the programme
 * planner's own reads — every bar; the sheet whole and the Event's Tournaments — for a member of
 * the Event's club only.
 *
 * Claire's login ran out over lunch. The public programme read takes her for a stranger and
 * leaves the draft Longsword Open's bars out (ruling 129); the planner saves the programme and
 * the sheet whole, so her next Save deleted them. This read answers an expired login 401, on
 * which the client renews it and asks again, so a stranger's view never reaches the planner.
 */
import 'reflect-metadata';
import { HttpException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  filtersFor,
  mockSupabase,
  queriedTables,
  selectsFor,
  type TableSeed,
} from '../../common/testing/supabase-chain';
import { OrganizationsService } from '../organizations/organizations.service';
import { ProgrammeController } from './programme.controller';
import { ProgrammeService } from './programme.service';

const EVENT = { id: 'e1', status: 'published', organization_id: 'org-a', event_kind: 'standard' };
// The sheet's schema takes a Tournament id only as a uuid.
const T_OPEN = '11111111-1111-4111-8111-111111111111';
const T_SECRET = '22222222-2222-4222-8222-222222222222';

const bar = (id: string, competitionId: string | null) => ({
  id,
  event_id: 'e1',
  day_index: 0,
  sort_order: 0,
  block_type: competitionId ? 'competition' : 'admin',
  label: id,
  competition_id: competitionId,
  competition_phase: competitionId ? 'pool' : null,
  workshop_id: null,
  lice_count: 0,
  start_time: '09:00:00',
  end_time: '10:00:00',
  color_hex: null,
  generated_at: null,
});

const TOKENS: Record<string, string> = {
  'tok-member': 'u-member',
  'tok-owner-b': 'u-owner-b',
};

let db: ReturnType<typeof mockSupabase>;

function seed(tables: Partial<Record<string, TableSeed>> = {}) {
  db = mockSupabase({
    events: { rows: [EVENT] },
    tournaments: {
      rows: [
        { id: T_SECRET, event_id: 'e1', name: 'Longsword Open', status: 'draft', sort_order: 2 },
        { id: T_OPEN, event_id: 'e1', name: 'Sabre Cup', status: 'published', sort_order: 1 },
      ],
    },
    event_programme_blocks: { rows: [bar('b-admin', null), bar('b-secret', T_SECRET)] },
    event_programme_configs: {
      rows: [
        {
          event_id: 'e1',
          config_json: { tournaments: [{ tournamentId: T_SECRET, poolMatchDurationMinutes: 9 }] },
        },
      ],
    },
    organization_members: {
      rows: [
        { organization_id: 'org-a', user_id: 'u-member', role: 'read_only' },
        { organization_id: 'org-b', user_id: 'u-owner-b', role: 'owner' },
      ],
    },
    event_staff_accounts: { rows: [{ id: 'staff-e1', event_id: 'e1', status: 'active' }] },
    ...tables,
  } as Record<string, TableSeed>);
}

function controller(req: object) {
  const supabase = {
    service: db.service,
    getAuthUser: (token: string) => Promise.resolve(TOKENS[token] ? { id: TOKENS[token] } : null),
  };
  const orgs = new OrganizationsService(supabase as never);
  const service = new ProgrammeService(supabase as never, orgs, {} as never);
  const programme = new ProgrammeController(service, supabase as never);
  return {
    blocks: () => programme.getPlannerBlocks('e1', req as never),
    sheet: () => programme.getPlannerSheet('e1', req as never),
  };
}

const ROUTES = ['blocks', 'sheet'] as const;
const signedIn = (token: string) => ({ headers: { authorization: `Bearer ${token}` } });
function refusal(req: object, route: (typeof ROUTES)[number]) {
  const reads = controller(req);
  return reads[route]().catch((error: unknown) => error);
}

beforeEach(() => seed());

describe('GET /programme/planner/* — the planner reads as the organiser (ruling 166b)', () => {
  it("gives a member of the Event's club every bar, draft Tournaments included", async () => {
    const blocks = await controller(signedIn('tok-member')).blocks();

    expect(blocks.map((block) => block.id)).toEqual(['b-admin', 'b-secret']);
    expect(selectsFor(db.from, 'event_programme_blocks')).toEqual(['*']);
    expect(filtersFor(db.from, 'event_programme_blocks', 'eq')).toEqual([['event_id', 'e1']]);
  });

  it("gives a member of the Event's club the whole sheet and every Tournament, in list order", async () => {
    const read = await controller(signedIn('tok-member')).sheet();

    expect(read.sheet.tournaments.map((row) => row.tournamentId)).toEqual([T_SECRET]);
    expect(read.tournaments).toEqual([
      { id: T_OPEN, name: 'Sabre Cup' },
      { id: T_SECRET, name: 'Longsword Open' },
    ]);
    expect(selectsFor(db.from, 'event_programme_configs')).toEqual(['config_json']);
    expect(selectsFor(db.from, 'tournaments')).toEqual(['id, name']);
    for (const table of ['event_programme_configs', 'tournaments']) {
      expect(filtersFor(db.from, table, 'eq'), table).toEqual([['event_id', 'e1']]);
    }
  });

  describe.each(ROUTES)('%s', (route) => {
    it.each([
      ['a signed-out caller', { headers: {} }],
      ['an expired login', signedIn('tok-expired')],
      [
        "the Event's staff session, which is no login",
        { headers: {}, staffSession: { staffId: 'staff-e1', eventId: 'e1' } },
      ],
    ])('answers %s 401, so the client renews the login first', async (_who, req) => {
      expect(await refusal(req, route)).toBeInstanceOf(UnauthorizedException);
      expect(queriedTables(db.from)).toEqual(['events']);
    });

    it('refuses a member of another club, before reading anything of the programme', async () => {
      expect(await refusal(signedIn('tok-owner-b'), route)).toBeInstanceOf(ForbiddenException);
      expect(queriedTables(db.from)).toEqual(['events', 'organization_members']);
    });

    it('answers an unknown Event 404', async () => {
      seed({ events: { rows: [] } });
      expect(await refusal(signedIn('tok-member'), route)).toBeInstanceOf(NotFoundException);
    });
  });

  it('fails a failed Tournament read as a 5xx, never as "no Tournament"', async () => {
    seed({ tournaments: { data: null, error: { message: 'connection reset' } } });
    const failure = await refusal(signedIn('tok-member'), 'sheet');
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(HttpException);
  });
});
