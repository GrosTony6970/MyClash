/**
 * `GET /me/events` (ruling 164, the bar of rulings 127 and 129): a signed-in entrant who is
 * neither a member of the Event's club nor an ACTIVE staff session of it sees nothing of a draft
 * Tournament until it is published — her own entry included — and nothing of a draft Event. An
 * Event she is tied to only by a draft entry drops out too (ruling 171a's bar,
 * `hiddenEntrantIds`). What is hidden answers exactly as if it did not exist. The membership and
 * staff checks run for real over seeded tables; the rows are in me-events.drafts.fixtures.ts.
 */
import 'reflect-metadata';
import { HttpException, UnauthorizedException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  filtersFor,
  mockSupabase,
  queriedTables,
  selectsFor,
} from '../../common/testing/supabase-chain';
import {
  baseTables,
  clubMember,
  duty,
  entry,
  lea,
  LONGSWORD_POOL,
  meController,
  SABRE,
  scheduleDouble,
  signedIn,
  SPRING,
  type Tables,
  WINTER,
  withStaff,
} from './me-events.drafts.fixtures';

// Its reads are its own, proven by its own test; a duty here is untimed.
vi.mock('../schedule/duty-windows', () => ({
  resolveDutyWindows: vi.fn(
    async (_db: unknown, _logger: unknown, duties: Array<{ id: string }>) =>
      new Map(duties.map((duty) => [duty.id, { startsAt: null, endsAt: null }])),
  ),
}));

let db: ReturnType<typeof mockSupabase>;

function seed(tables: Tables = baseTables()) {
  db = mockSupabase(tables);
}

const myEvents = async (req: object = signedIn) =>
  meController(db, scheduleDouble()).events(req as never);
const shape = async (req: object = signedIn) =>
  (await myEvents(req)).map((e) => ({
    event: e.event.id,
    tournaments: e.tournaments.map((t) => `${t.id}${t.registered ? '*' : ''}`),
    duties: e.refereeOf.map((d) => d.id),
    counts: e.counts,
  }));

beforeEach(() => seed());

const OUTSIDER_VIEW = [
  {
    event: 'e-pub',
    tournaments: ['t-sabre*'],
    duties: ['d-lice'],
    counts: { matches: 1, refereeSlots: 1, workshops: 0 },
  },
];

describe('/me/events hides what an outsider may not see (ruling 164)', () => {
  it('shows an entrant from another club only the public Tournaments of public Events', async () => {
    expect(await shape()).toEqual(OUTSIDER_VIEW);
  });

  it('answers exactly as if the hidden Tournaments, entries, duties and Events did not exist', async () => {
    const hidden = new Set(['e-draft', 'p-draft', 'p-only', 't-long', 'r-long', 'm-long']);
    const tables = baseTables();
    const strip = (table: string, drop: (row: Record<string, unknown>) => boolean) => {
      const seedRows = (tables[table] as { rows: Array<Record<string, unknown>> }).rows;
      tables[table] = { rows: seedRows.filter((row) => !drop(row)) };
    };
    strip('events', (row) => hidden.has(row['id'] as string));
    strip('tournaments', (row) => hidden.has(row['id'] as string) || row['status'] === 'draft');
    strip('persons', (row) => hidden.has(row['id'] as string));
    strip(
      'registrations',
      (row) => hidden.has(row['id'] as string) || row['person_id'] === 'p-only',
    );
    strip('matches', (row) => hidden.has(row['id'] as string));
    strip('referee_assignments', (row) => row['id'] !== 'd-lice');
    strip('event_instructors', () => true);
    const seen = JSON.stringify(await myEvents());

    seed(tables);
    expect(JSON.stringify(await myEvents())).toBe(seen);
  });

  it('reads the Events and Tournaments it decides on, and 5xxs when either read fails', async () => {
    await myEvents();
    expect(selectsFor(db.from, 'events')).toEqual(['id, status, organization_id, event_kind']);
    expect(filtersFor(db.from, 'events', 'in')).toEqual([['id', ['e-pub', 'e-draft', 'e-only']]]);
    expect(selectsFor(db.from, 'tournaments')[0]).toBe('id, event_id, slug, name, weapon, status');
    // A draft Event hidden from her: not even its Tournaments are read.
    expect(filtersFor(db.from, 'tournaments', 'in')[0]).toEqual(['event_id', ['e-pub', 'e-only']]);

    for (const table of ['events', 'tournaments']) {
      seed({ ...baseTables(), [table]: { data: null, error: { message: 'boom' } } });
      const failure = await myEvents().catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(Error);
      expect(failure).not.toBeInstanceOf(HttpException);
      expect(String(failure)).toContain(`${table} read failed: boom`);
    }
  });

  it("shows a member of the Event's club every Tournament, duty and draft Event", async () => {
    seed(clubMember());
    expect(await shape()).toEqual([
      {
        event: 'e-pub',
        tournaments: ['t-long*', 't-sabre*'],
        duties: ['d-lice', 'd-long'],
        counts: { matches: 2, refereeSlots: 2, workshops: 0 },
      },
      {
        event: 'e-only',
        tournaments: ['t-winter', 't-winter-secret*'],
        duties: [],
        counts: { matches: 0, refereeSlots: 0, workshops: 0 },
      },
      {
        event: 'e-draft',
        tournaments: ['t-autumn*'],
        duties: ['d-autumn'],
        counts: { matches: 1, refereeSlots: 1, workshops: 0 },
      },
    ]);
  });

  it("shows an active staff session its own Event's drafts, and nothing of another Event's", async () => {
    expect(await shape(withStaff('staff-pub', 'e-pub'))).toEqual([
      {
        event: 'e-pub',
        tournaments: ['t-long*', 't-sabre*'],
        duties: ['d-lice', 'd-long'],
        counts: { matches: 2, refereeSlots: 2, workshops: 0 },
      },
    ]);
    expect((await shape(withStaff('staff-draft', 'e-draft'))).map((e) => e.event)).toEqual([
      'e-pub',
      'e-draft',
    ]);
    expect((await shape(withStaff('staff-draft', 'e-draft')))[0]).toEqual(OUTSIDER_VIEW[0]);
  });

  it('shows a disabled staff session only what an outsider sees', async () => {
    expect(await shape(withStaff('staff-off', 'e-pub'))).toEqual(OUTSIDER_VIEW);
  });

  it('keeps an Event her draft entry alone would not show when she has a Workshop there', async () => {
    const tables = baseTables();
    tables['workshop_enrollments'] = {
      rows: [
        {
          user_id: 'p-only',
          status: 'confirmed',
          workshop_sessions: { workshops: { event_id: 'e-only', events: WINTER } },
        },
      ],
    };
    seed(tables);
    expect(await shape()).toEqual([
      OUTSIDER_VIEW[0],
      {
        event: 'e-only',
        tournaments: ['t-winter'],
        duties: [],
        counts: { matches: 0, refereeSlots: 0, workshops: 1 },
      },
    ]);
  });

  it('leaves out an Event whose only tie to her is a duty in a draft Tournament', async () => {
    const tables = baseTables();
    tables['persons'] = { rows: [] };
    tables['registrations'] = { rows: [] };
    tables['referee_assignments'] = { rows: [duty('d-long', SPRING, LONGSWORD_POOL)] };
    tables['event_instructors'] = { rows: [] };
    seed(tables);
    expect(await shape()).toEqual([]);

    tables['organization_members'] = clubMember()['organization_members']!;
    seed(tables);
    expect((await shape()).map((e) => [e.event, e.duties])).toEqual([['e-pub', ['d-long']]]);
  });

  it('5xxs when the membership read fails, never reading it as "not a member"', async () => {
    seed({ ...baseTables(), organization_members: { data: null, error: { message: 'boom' } } });
    const failure = await myEvents().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(HttpException);
    expect(String(failure)).toContain('membership read failed: boom');
  });

  it('asks for no membership when nothing of hers is hidden', async () => {
    const tables = baseTables();
    tables['events'] = { rows: [SPRING] };
    tables['tournaments'] = { rows: [SABRE] };
    tables['persons'] = { rows: [lea('p-pub', SPRING)] };
    tables['registrations'] = { rows: [entry('r-sabre', 'p-pub', 't-sabre', 3)] };
    tables['referee_assignments'] = { rows: [duty('d-lice', SPRING, null)] };
    tables['event_instructors'] = { rows: [] };
    seed(tables);
    expect(await shape()).toEqual(OUTSIDER_VIEW);
    expect(queriedTables(db.from)).not.toContain('organization_members');
  });

  it('refuses a caller with no login before reading anything', async () => {
    const failure = await myEvents({ headers: {} }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(UnauthorizedException);
    expect(db.from).not.toHaveBeenCalled();
  });
});
