/**
 * `GET /events/:eventId/persons/lookup` (ruling 129, the bar of rulings 81-83 and 127; ruling
 * 167): a person entered ONLY in Tournaments hidden from the caller is left out, exactly as if
 * they did not exist, for anyone but a member of the Event's club or an ACTIVE staff session of
 * the same Event. A person with no entry (a Workshop attendee) stays, and so does a referee or
 * instructor of the Event: they are public through that role. The checks run for real over
 * seeded tables; `lookup_persons` (migration 0003) is faked by name.
 */
import 'reflect-metadata';
import { HttpException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  filtersFor,
  mockSupabase,
  queriedTables,
  selectsFor,
  type TableSeed,
} from '../../common/testing/supabase-chain';
import { OrganizationsService } from '../organizations/organizations.service';
import { CsvImportService } from './csv-import.service';
import { LookupController } from './lookup.controller';

const EVENT = { id: 'e1', status: 'published', organization_id: 'org-a', event_kind: 'standard' };

const person = (id: string, given: string, family: string) => ({
  id,
  event_id: 'e1',
  given_name: given,
  family_name: family,
  email: `${given.toLowerCase()}@example.com`,
  claimed_by_user_id: null,
  global_person_id: `gp-${id}`,
  clubs: { name: 'Salle Nord' },
});
const entry = (personId: string, tournamentId: string, status = 'registered') => ({
  id: `r-${personId}-${tournamentId}`,
  person_id: personId,
  tournament_id: tournamentId,
  status,
});

const PERSONS = [
  person('p-ann', 'Ann', 'Archer'), // the published Tournament
  person('p-bea', 'Bea', 'Blake'), // the draft only
  person('p-cal', 'Cal', 'Cole'), // both
  person('p-dan', 'Dan', 'Drew'), // the draft only, but referees the Event
  person('p-eve', 'Eve', 'Evans'), // the draft only, but teaches at the Event
  person('p-fay', 'Fay', 'Ford'), // no entry: a Workshop attendee
  person('p-gus', 'Gus', 'Grey'), // withdrawn, from the draft only
  person('p-hal', 'Hal', 'Hunt'), // withdrawn from the published one, entered in the draft (168)
];
const EVERYONE = ['Archer', 'Blake', 'Cole', 'Drew', 'Evans', 'Ford', 'Grey', 'Hunt'];
const PUBLIC = ['Archer', 'Cole', 'Drew', 'Evans', 'Ford'];

let db: ReturnType<typeof mockSupabase>;
let rpc: ReturnType<typeof vi.fn>;

function seed(tables: Partial<Record<string, TableSeed>> = {}, rpcFails = false) {
  db = mockSupabase({
    events: { rows: [EVENT] },
    tournaments: {
      rows: [
        { id: 't-open', event_id: 'e1', status: 'published' },
        { id: 't-secret', event_id: 'e1', status: 'draft' },
      ],
    },
    persons: { rows: PERSONS },
    registrations: {
      rows: [
        entry('p-ann', 't-open'),
        entry('p-bea', 't-secret'),
        entry('p-cal', 't-secret'),
        entry('p-cal', 't-open', 'checked_in'),
        entry('p-dan', 't-secret'),
        entry('p-eve', 't-secret'),
        entry('p-gus', 't-secret', 'withdrawn'),
        entry('p-hal', 't-open', 'withdrawn'),
        entry('p-hal', 't-secret'),
      ],
    },
    event_referees: { rows: [{ event_id: 'e1', person_id: 'gp-p-dan' }] },
    event_instructors: { rows: [{ event_id: 'e1', person_id: 'gp-p-eve' }] },
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
  rpc = fakeLookupPersons(rpcFails);
}

/** lookup_persons: the Event's people whose name holds the query, best first, `p_limit` of them. */
function fakeLookupPersons(rpcFails: boolean) {
  return vi.fn(
    async (_name: string, args: { p_event_id: string; p_query: string; p_limit: number }) => {
      if (rpcFails) return { data: null, error: { message: 'function not found' } };
      const { data } = await db.service.from('persons').select('*').eq('event_id', args.p_event_id);
      const hits = ((data ?? []) as typeof PERSONS)
        .filter((p) => `${p.given_name} ${p.family_name}`.includes(args.p_query))
        .slice(0, args.p_limit);
      return {
        data: hits.map((p) => ({ ...p, club_label: p.clubs.name, masked_email: 'x***@e***.com' })),
        error: null,
      };
    },
  );
}

function lookup(query: { q?: string; limit?: string }, req: object = {}) {
  const supabase = { service: { from: db.service.from, rpc } };
  const orgs = new OrganizationsService(supabase as never);
  const controller = new LookupController(supabase as never, new CsvImportService(), orgs);
  return controller.lookup('e1', query, { headers: {}, ...req } as never);
}
const families = async (query: { q?: string; limit?: string }, req: object = {}) =>
  (await lookup(query, req)).map((row) => row.family_name);

const claimed = (userId: string) => ({ identity: { kind: 'claimed', userId, email: null } });
const staffOf = (staffId: string, eventId: string) => ({ staffSession: { staffId, eventId } });

beforeEach(() => seed());

describe('GET /persons/lookup leaves out who is entered only in a draft (rulings 129, 167, 168)', () => {
  it('lists a signed-out visitor everyone but the draft-only entrants, reading what it needs', async () => {
    expect(await families({})).toEqual(PUBLIC);
    expect(selectsFor(db.from, 'events')).toEqual(['status, organization_id, event_kind']);
    expect(selectsFor(db.from, 'tournaments')).toEqual(['id, status']);
    expect(selectsFor(db.from, 'registrations')).toEqual(['person_id', 'person_id, tournament_id']);
    expect(filtersFor(db.from, 'registrations', 'in')).toEqual([
      ['tournament_id', ['t-secret']],
      ['person_id', ['p-bea', 'p-cal', 'p-dan', 'p-eve', 'p-gus', 'p-hal']],
      // Only a live entry in a public Tournament keeps someone findable (ruling 168).
      ['status', ['registered', 'checked_in', 'waitlist']],
    ]);
    // The staff exception keys on the global person: without that column, no one is staff.
    expect(selectsFor(db.from, 'persons')).toEqual([
      'id, global_person_id',
      'id, given_name, family_name, email, claimed_by_user_id, global_person_id, clubs(name)',
    ]);
    expect(filtersFor(db.from, 'persons', 'in')).toEqual([
      ['id', ['p-bea', 'p-dan', 'p-eve', 'p-gus', 'p-hal']],
    ]);
    expect(selectsFor(db.from, 'event_referees')).toEqual(['person_id']);
    expect(selectsFor(db.from, 'event_instructors')).toEqual(['person_id']);
    expect(filtersFor(db.from, 'event_referees', 'eq')).toEqual([['event_id', 'e1']]);
    expect(filtersFor(db.from, 'event_instructors', 'eq')).toEqual([['event_id', 'e1']]);
  });

  it.each([
    ['a member of another club', claimed('u-owner-b')],
    ["another Event's staff", staffOf('staff-e2', 'e2')],
    ['a disabled staff session', staffOf('staff-off', 'e1')],
  ])('lists %s the same', async (_who, req) => {
    expect(await families({}, req)).toEqual(PUBLIC);
  });

  it.each([
    ["a member of the Event's club", claimed('u-member')],
    ["the Event's active staff session", staffOf('staff-e1', 'e1')],
  ])('lists %s everyone, and costs no entry read', async (_who, req) => {
    expect(await families({}, req)).toEqual(EVERYONE);
    expect(queriedTables(db.from)).not.toContain('registrations');
  });

  it('never lets a hidden entrant crowd out a visible one under the limit', async () => {
    expect(await families({ limit: '2' })).toEqual(['Archer', 'Cole']);
    // Three hidden, so five read, then two kept: Blake alone would have taken a place.
    expect(filtersFor(db.from, 'persons', 'limit')).toEqual([[5]]);
  });

  it('reads a limit below one as the default, never as a database error', async () => {
    expect(await families({ limit: '-1' })).toEqual(PUBLIC);
  });

  it('answers a search for a draft-only entrant exactly as a search for no one', async () => {
    expect(await lookup({ q: 'Blake' })).toEqual(await lookup({ q: 'Nobody' }));
    expect(await families({ q: 'Blake' }, claimed('u-member'))).toEqual(['Blake']);
    // Asked for ten plus the three hidden, so that the ten it keeps are all visible.
    expect(rpc).toHaveBeenCalledWith('lookup_persons', {
      p_event_id: 'e1',
      p_query: 'Blake',
      p_limit: 13,
      p_threshold: 0.3,
    });
  });

  it('holds the same bar on the name search the database falls back to', async () => {
    seed({}, true);
    expect(await lookup({ q: 'Blake' })).toEqual([]);
    expect(await families({ q: 'Blake' }, claimed('u-member'))).toEqual(['Blake']);
  });

  it('answers an Event whose draft-only entrant is hidden exactly as one without her', async () => {
    const withBea = await lookup({});
    seed({
      persons: { rows: PERSONS.filter((p) => !['p-bea', 'p-gus', 'p-hal'].includes(p.id)) },
    });
    expect(withBea).toEqual(await lookup({}));
  });

  it('keeps a draft Event hidden: 404 in the unknown-Event words; an unknown Event lists no one', async () => {
    seed({ events: { rows: [{ ...EVENT, status: 'draft' }] } });
    const failure = await lookup({}).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(NotFoundException);
    expect((failure as Error).message).toBe('Event "e1" not found');
    seed({ events: { rows: [] } });
    expect(await lookup({})).toEqual([]);
    expect(queriedTables(db.from)).toEqual(['events']);
  });

  it.each([
    'events',
    'tournaments',
    'registrations',
    'persons',
    'event_referees',
    'event_instructors',
  ])('fails a failed %s read as a 5xx, never as "no one"', async (table) => {
    seed({ [table]: { data: null, error: { message: 'connection reset' } } });
    const failure = await lookup({}).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(HttpException);
  });

  it.each([
    ['the list', {}],
    ['the fallback name search', { q: 'Blake' }],
  ])('fails a failed people read in %s as a 5xx, never as "no one"', async (_path, query) => {
    // Nothing hidden, so the only people read is the list's or the search's own.
    seed(
      {
        tournaments: { rows: [{ id: 't-open', event_id: 'e1', status: 'published' }] },
        persons: { data: null, error: { message: 'connection reset' } },
      },
      true,
    );
    const failure = await lookup(query).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(HttpException);
  });
});
