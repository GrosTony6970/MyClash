/**
 * Who may read and change an Event's roster.
 *
 * Until 2026-09-18 none of these routes asked. With the guard in shadow mode (the
 * production default) a caller with no token read every person's email, date of
 * birth and notes, edited them, and force-deleted them — and the import preview
 * answered any uploaded name with that person's email from ANY organisation's
 * Event. Create and import did take the caller's id, but only to stamp
 * `created_by_user_id` on the new row: the identity reached no decision.
 *
 * Two bars, the referee board's: reading the roster needs membership of the
 * Event's organisation at any role; changing it needs `editor`. The preview is a
 * change — it is the first step of an import, and it names people from any
 * organisation's roster (their email is masked in the service). A route
 * addressed by person id checks the Event the PERSON belongs to, never an id the
 * caller sends.
 *
 * Driven through the controller and the real org-role check over seeded tables.
 * The roster services are stubs, so "refused" means "never reached".
 */
import { BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { mockSupabase, queriedTables, selectsFor } from '../../common/testing/supabase-chain';
import { OrganizationsService } from '../organizations/organizations.service';
import { PersonsController } from './persons.controller';

const EVENT_A = '11111111-1111-4111-8111-111111111111';
const EVENT_B = '22222222-2222-4222-8222-222222222222';
/** Anna is on Event A's roster, Bruno on Event B's. */
const ANNA = '33333333-3333-4333-8333-333333333333';
const BRUNO = '44444444-4444-4444-8444-444444444444';

let db: ReturnType<typeof mockSupabase>;
let persons: Record<string, Mock>;
let assignments: { forceDeletePersonInEvent: Mock };
let controller: PersonsController;

beforeEach(() => {
  db = mockSupabase({
    events: {
      rows: [
        { id: EVENT_B, organization_id: 'org-b' },
        { id: EVENT_A, organization_id: 'org-a' },
      ],
    },
    persons: {
      rows: [
        { id: BRUNO, event_id: EVENT_B },
        { id: ANNA, event_id: EVENT_A },
      ],
    },
    organization_members: {
      rows: [
        { organization_id: 'org-b', user_id: 'u-editor-b', role: 'editor' },
        { organization_id: 'org-a', user_id: 'u-editor-a', role: 'editor' },
        // Owner elsewhere, read-only here: a decision taken on the wrong
        // organisation would let this account change Event A's roster.
        { organization_id: 'org-b', user_id: 'u-reader-a', role: 'owner' },
        { organization_id: 'org-a', user_id: 'u-reader-a', role: 'read_only' },
      ],
    },
  });
  persons = {
    listPersons: vi.fn(async () => []),
    getPerson: vi.fn(async () => ({})),
    createPerson: vi.fn(async () => ({})),
    updatePerson: vi.fn(async () => ({})),
    deletePerson: vi.fn(async () => undefined),
    previewImport: vi.fn(async () => ({})),
    importCsv: vi.fn(async () => ({})),
  };
  assignments = { forceDeletePersonInEvent: vi.fn(async () => undefined) };
  // The token IS the user id here; no token at all is the anonymous caller.
  const supabase = {
    service: db.service,
    getAuthUser: vi.fn(async (token: string) => ({ id: token })),
  };
  controller = new PersonsController(
    persons as never,
    supabase as never,
    assignments as never,
    new OrganizationsService(db as never),
  );
});

type Req = { headers: Record<string, string>; cookies: Record<string, string>; parts: Mock };

/** A request from `userId` (none = no token), carrying a one-line CSV upload. */
function req(userId?: string): Req {
  return {
    headers: userId ? { authorization: `Bearer ${userId}` } : {},
    cookies: {},
    parts: vi.fn(() =>
      (async function* () {
        yield {
          type: 'file',
          fieldname: 'file',
          toBuffer: async () => Buffer.from('given_name,family_name\nEve,Example\n'),
        };
      })(),
    ),
  };
}

interface Route {
  /** The handler, which each route's docblock in the controller names by path. */
  name: string;
  bar: 'read' | 'change';
  /** Addressed by person id, so the Event is the person's own. */
  byPerson: boolean;
  call: (r: Req, person?: string, event?: string) => Promise<unknown>;
  /** The service method the route hands over to, and the arguments it must get. */
  reached: () => Mock;
  handed: unknown[];
}

const ROUTES: Route[] = [
  {
    name: 'list',
    bar: 'read',
    byPerson: false,
    call: (r, _p, event = EVENT_A) => controller.list(event, r as never),
    reached: () => persons.listPersons!,
    handed: [EVENT_A],
  },
  {
    name: 'getOne',
    bar: 'read',
    byPerson: true,
    call: (r, person = ANNA) => controller.getOne(person, r as never),
    reached: () => persons.getPerson!,
    handed: [ANNA],
  },
  {
    name: 'create',
    bar: 'change',
    byPerson: false,
    call: (r, _p, event = EVENT_A) =>
      controller.create(event, { givenName: 'Eve', familyName: 'Example' } as never, r as never),
    reached: () => persons.createPerson!,
    handed: [EVENT_A, { givenName: 'Eve', familyName: 'Example' }, 'u-editor-a'],
  },
  {
    name: 'previewImport',
    bar: 'change',
    byPerson: false,
    call: (r, _p, event = EVENT_A) => controller.previewImport(event, r as never),
    reached: () => persons.previewImport!,
    handed: [EVENT_A, expect.any(Buffer)],
  },
  {
    name: 'importCsv',
    bar: 'change',
    byPerson: false,
    call: (r, _p, event = EVENT_A) => controller.importCsv(event, r as never),
    reached: () => persons.importCsv!,
    handed: [EVENT_A, expect.any(Buffer), 'u-editor-a', []],
  },
  {
    name: 'update',
    bar: 'change',
    byPerson: true,
    call: (r, person = ANNA) => controller.update(person, { notes: 'x' } as never, r as never),
    reached: () => persons.updatePerson!,
    handed: [ANNA, { notes: 'x' }],
  },
  {
    name: 'delete',
    bar: 'change',
    byPerson: true,
    call: (r, person = ANNA) => controller.delete(person, r as never),
    reached: () => persons.deletePerson!,
    handed: [ANNA],
  },
  {
    name: 'delete ?force=true',
    bar: 'change',
    byPerson: true,
    // The query names the caller's OWN Event when it has one to name.
    call: (r, person = ANNA, event = EVENT_A) =>
      controller.delete(person, r as never, 'true', event),
    reached: () => assignments.forceDeletePersonInEvent,
    handed: [ANNA, EVENT_A],
  },
];

const READS = ROUTES.filter((route) => route.bar === 'read');
const CHANGES = ROUTES.filter((route) => route.bar === 'change');
const BY_PERSON = ROUTES.filter((route) => route.byPerson);

describe('PersonsController authorization', () => {
  it('covers every handler of the controller', () => {
    // A handler added to the controller and not to ROUTES is checked by nothing.
    const handlers = Object.getOwnPropertyNames(PersonsController.prototype).filter(
      (name) => name !== 'constructor' && name !== 'authz',
    );
    const covered = new Set(ROUTES.map((route) => route.name.split(' ')[0]));
    expect(handlers.sort()).toEqual([...covered].sort());
  });

  it.each(ROUTES)('$name refuses a caller with no token, before any read', async (route) => {
    const r = req();
    await expect(route.call(r)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(route.reached()).not.toHaveBeenCalled();
    expect(queriedTables(db.from)).toEqual([]);
    expect(r.parts).not.toHaveBeenCalled();
  });

  it.each(ROUTES)(
    '$name refuses a signed-in account outside the organisation, before reading any upload',
    async (route) => {
      const r = req('u-stranger');
      await expect(route.call(r)).rejects.toBeInstanceOf(ForbiddenException);
      expect(route.reached()).not.toHaveBeenCalled();
      expect(r.parts).not.toHaveBeenCalled();
    },
  );

  it.each(READS)('$name lets any member of the organisation read', async (route) => {
    await route.call(req('u-reader-a'));
    expect(route.reached()).toHaveBeenCalledOnce();
  });

  it.each(CHANGES)('$name refuses a read-only member', async (route) => {
    await expect(route.call(req('u-reader-a'))).rejects.toBeInstanceOf(ForbiddenException);
    expect(route.reached()).not.toHaveBeenCalled();
  });

  it.each(ROUTES)(
    '$name lets an editor of the Event through, with the ids it was sent',
    async (route) => {
      await route.call(req('u-editor-a'));
      expect(route.reached()).toHaveBeenCalledWith(...route.handed);
    },
  );

  it.each(BY_PERSON)("$name checks the person's own Event, not the caller's", async (route) => {
    // Event B's editor, acting on Anna of Event A — naming Event B where the
    // route takes an Event at all.
    await expect(route.call(req('u-editor-b'), ANNA, EVENT_B)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(route.reached()).not.toHaveBeenCalled();
  });

  it("refuses to force-delete a person under an Event that is not the person's", async () => {
    // Anna's own editor, naming Event B: the purge probes the named Event's
    // bouts, then deletes the person — so the two must be the same Event.
    await expect(
      controller.delete(ANNA, req('u-editor-a') as never, 'true', EVENT_B),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(assignments.forceDeletePersonInEvent).not.toHaveBeenCalled();
    expect(persons.deletePerson).not.toHaveBeenCalled();
  });

  it('checks the Event in the path, for a route that names one', async () => {
    // Event A's editor, asking for Event B's roster.
    await expect(controller.list(EVENT_B, req('u-editor-a') as never)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(persons.listPersons).not.toHaveBeenCalled();
  });

  it("reads the person's Event from the person row", async () => {
    await controller.getOne(ANNA, req('u-reader-a') as never);
    // The double hands back the whole row whatever is selected, so the outcome
    // alone would stay green with `event_id` dropped from the read.
    expect(selectsFor(db.from, 'persons')).toEqual(['event_id']);
  });

  it('knows the caller by the session cookie, which is all the admin pages send', async () => {
    const cookieOnly = { ...req(), cookies: { 'sb-access-token': 'u-editor-a' } };
    await controller.create(EVENT_A, { givenName: 'Eve' } as never, cookieOnly as never);
    expect(persons.createPerson).toHaveBeenCalledWith(EVENT_A, { givenName: 'Eve' }, 'u-editor-a');
  });
});
