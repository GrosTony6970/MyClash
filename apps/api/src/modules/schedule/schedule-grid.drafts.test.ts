import { ForbiddenException, HttpException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicReader } from '../../common/auth/competition-visibility';
import { ANONYMOUS_USER_ID } from '../../common/auth/request-user';
import {
  mockSupabase,
  queriedTables,
  selectsFor,
  type TableSeed,
} from '../../common/testing/supabase-chain';
import { ScheduleGridService } from './schedule-grid.service';

// Ruling 129 (the bar of ruling 127): the public schedule grid leaves out a draft Tournament's
// bouts — fighters' names included — for anyone but a member of the Event's club or an active
// staff session of the Event. The organiser's own grid (web-admin, signed in) keeps them.

// The lengths and the sheet make reads of their own; what they answer is not this file's concern.
vi.mock('./match-lengths', () => ({
  resolveMatchLengths: vi.fn((_db: unknown, _eventId: string, inputs: Array<{ id: string }>) =>
    Promise.resolve(new Map(inputs.map((input) => [input.id, 5]))),
  ),
}));
vi.mock('../programme/programme-sheet', () => ({
  readProgrammeSheet: vi.fn(() => Promise.resolve({ minRestMinutes: 10, tournaments: [] })),
}));

const EVENT = { id: 'e1', status: 'published', organization_id: 'club', event_kind: 'standard' };
const OPEN = {
  id: 't-open',
  event_id: 'e1',
  name: 'Sabre Cup',
  slug: 'sabre',
  status: 'published',
};
const SECRET = {
  id: 't-secret',
  event_id: 'e1',
  name: 'Longsword Open',
  slug: 'longsword',
  status: 'draft',
};
const bout = (id: string, phase: string) => ({
  id,
  match_number_label: `${id}-label`,
  status: 'scheduled',
  lice_id: null,
  scheduled_at: null,
  phase_id: phase,
  pool_id: null,
  bracket_slot_id: null,
  swiss_round_id: null,
  red_registration_id: `${id}-red`,
  blue_registration_id: `${id}-blue`,
  planned_duration_override_minutes: null,
});

const MEMBER = 'member-user';
const orgs = {
  assertOrgRole: vi.fn((_org: string, userId: string) =>
    userId === MEMBER ? Promise.resolve() : Promise.reject(new ForbiddenException('not a member')),
  ),
};

function grid(tables: Partial<Record<string, TableSeed>> = {}) {
  const db = mockSupabase({
    events: { rows: [EVENT] },
    tournaments: { rows: [OPEN, SECRET] },
    phases: {
      rows: [
        { id: 'ph-open', type: 'pool', tournament_id: 't-open', config_json: null },
        { id: 'ph-secret', type: 'pool', tournament_id: 't-secret', config_json: null },
      ],
    },
    matches: { rows: [bout('m-open', 'ph-open'), bout('m-secret', 'ph-secret')] },
    vw_tournament_query_matches: {
      rows: [
        { match_id: 'm-open', red_name: 'Ann', blue_name: 'Ben' },
        { match_id: 'm-secret', red_name: 'Lea', blue_name: 'Max' },
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
  return { db, service: new ScheduleGridService(db as never, orgs as never) };
}

const reader = (userId: string, staff: PublicReader['staff'] = null): PublicReader => ({
  userId,
  staff,
});
const staffOf = (staffId: string, eventId: string) =>
  ({ staffId, eventId }) as PublicReader['staff'];
const boutsSeen = async (service: ScheduleGridService, who: PublicReader) =>
  (await service.listEventSchedule('e1', who)).map((row) => [row.id, row.redFighterName]);

describe('ScheduleGridService — a draft Tournament stays off the public grid (ruling 129)', () => {
  beforeEach(() => {
    orgs.assertOrgRole.mockClear();
  });

  it('shows an anonymous visitor only the published Tournament, names and all', async () => {
    const { db, service } = grid();
    expect(await boutsSeen(service, reader(ANONYMOUS_USER_ID))).toEqual([['m-open', 'Ann']]);
    expect(selectsFor(db.from, 'events')).toEqual(['status, organization_id, event_kind']);
    expect(selectsFor(db.from, 'tournaments')).toEqual(['id, name, slug, weapon, color, status']);
    // An anonymous visitor costs no membership read.
    expect(orgs.assertOrgRole).not.toHaveBeenCalled();
  });

  it('shows a member of another club only the published Tournament', async () => {
    const { service } = grid();
    expect(await boutsSeen(service, reader('stranger'))).toEqual([['m-open', 'Ann']]);
  });

  it("shows a member of the Event's club the draft too", async () => {
    const { service } = grid();
    expect(await boutsSeen(service, reader(MEMBER))).toEqual([
      ['m-open', 'Ann'],
      ['m-secret', 'Lea'],
    ]);
    expect(orgs.assertOrgRole).toHaveBeenCalledWith('club', MEMBER, 'read_only');
  });

  it("shows the Event's active staff session the draft, but not another Event's or a disabled one", async () => {
    const { service } = grid();
    const both = [
      ['m-open', 'Ann'],
      ['m-secret', 'Lea'],
    ];
    const open = [['m-open', 'Ann']];
    expect(await boutsSeen(service, reader(ANONYMOUS_USER_ID, staffOf('staff-e1', 'e1')))).toEqual(
      both,
    );
    expect(await boutsSeen(service, reader(ANONYMOUS_USER_ID, staffOf('staff-e2', 'e2')))).toEqual(
      open,
    );
    expect(await boutsSeen(service, reader(ANONYMOUS_USER_ID, staffOf('staff-off', 'e1')))).toEqual(
      open,
    );
  });

  it('answers an Event whose only Tournament is a draft exactly as one with no Tournament', async () => {
    const onlyDraft = grid({ tournaments: { rows: [SECRET] } });
    const none = grid({ tournaments: { rows: [] } });
    expect(await onlyDraft.service.listEventSchedule('e1', reader('stranger'))).toEqual(
      await none.service.listEventSchedule('e1', reader('stranger')),
    );
    // The draft's phases and bouts are never read for an outsider.
    expect(queriedTables(onlyDraft.db.from)).not.toContain('matches');
  });

  it('keeps a draft Event hidden as before: 404 in the unknown-Event words', async () => {
    const { db, service } = grid({ events: { rows: [{ ...EVENT, status: 'draft' }] } });
    const failure = await service
      .listEventSchedule('e1', reader('stranger'))
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(NotFoundException);
    expect((failure as Error).message).toBe('Event "e1" not found');
    expect(queriedTables(db.from)).toEqual(['events']);
  });

  it('answers an unknown Event with an empty grid, as it always has', async () => {
    const { service } = grid({ events: { rows: [] } });
    expect(await service.listEventSchedule('e1', reader(ANONYMOUS_USER_ID))).toEqual([]);
  });

  it('fails a failed Event or Tournament read as a 5xx, never as "nothing hidden"', async () => {
    for (const table of ['events', 'tournaments']) {
      const { service } = grid({ [table]: { data: null, error: { message: 'connection reset' } } });
      const failure = await service
        .listEventSchedule('e1', reader(ANONYMOUS_USER_ID))
        .catch((error: unknown) => error);
      expect(failure, table).toBeInstanceOf(Error);
      expect(failure, table).not.toBeInstanceOf(HttpException);
    }
  });
});
