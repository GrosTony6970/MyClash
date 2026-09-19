/**
 * Who may read and change a tournament's registrations.
 *
 * Until 2026-09-19 none of these routes asked. With the guard in shadow mode (the
 * production default) a caller with no token listed every entrant with their
 * email, registered, withdrew, promoted and deleted entrants, and force-deleted
 * a registration with its unplayed bouts. Registering also took a person id from
 * ANY Event's roster.
 *
 * The persons routes' two bars: reading needs membership of the Event's
 * organisation at any role; changing needs `editor`. A route addressed by a
 * tournament, a registration or a person checks the Event that row is on, never
 * an id the caller sends.
 *
 * Driven through the controller and the real org-role check over seeded tables.
 * The registration services are stubs, so "refused" means "never reached".
 */
import { BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { mockSupabase, queriedTables, selectsFor } from '../../common/testing/supabase-chain';
import { OrganizationsService } from '../organizations/organizations.service';
import { CreateRegistrationDto } from './dto/registrations.dto';
import { RegistrationsController } from './registrations.controller';

const EVENT_A = '11111111-1111-4111-8111-111111111111';
const EVENT_B = '22222222-2222-4222-8222-222222222222';
const TOURNAMENT_A = '55555555-5555-4555-8555-555555555555';
const TOURNAMENT_B = '66666666-6666-4666-8666-666666666666';
/** Anna is on Event A's roster and entered in its tournament; Bruno is Event B's. */
const ANNA = '33333333-3333-4333-8333-333333333333';
const BRUNO = '44444444-4444-4444-8444-444444444444';
const ENTRY_A = '77777777-7777-4777-8777-777777777777';
const ENTRY_B = '88888888-8888-4888-8888-888888888888';
/** On no Event's roster. */
const NOBODY = '99999999-9999-4999-8999-999999999999';

let db: ReturnType<typeof mockSupabase>;
let registrations: Record<string, Mock>;
let assignments: Record<string, Mock>;
let controller: RegistrationsController;

beforeEach(() => {
  db = mockSupabase({
    events: {
      rows: [
        { id: EVENT_B, organization_id: 'org-b' },
        { id: EVENT_A, organization_id: 'org-a' },
      ],
    },
    tournaments: {
      rows: [
        { id: TOURNAMENT_B, event_id: EVENT_B },
        { id: TOURNAMENT_A, event_id: EVENT_A },
      ],
    },
    registrations: {
      rows: [
        { id: ENTRY_B, tournament_id: TOURNAMENT_B },
        { id: ENTRY_A, tournament_id: TOURNAMENT_A },
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
        // organisation would let this account change Event A's entries.
        { organization_id: 'org-b', user_id: 'u-reader-a', role: 'owner' },
        { organization_id: 'org-a', user_id: 'u-reader-a', role: 'read_only' },
        // Editor of both: only the same-Event rule can refuse this account.
        { organization_id: 'org-a', user_id: 'u-editor-ab', role: 'editor' },
        { organization_id: 'org-b', user_id: 'u-editor-ab', role: 'editor' },
      ],
    },
  });
  registrations = {
    list: vi.fn(async () => []),
    listForEvent: vi.fn(async () => []),
    create: vi.fn(async () => ({})),
    addToWaitlist: vi.fn(async () => ({})),
    updateStatus: vi.fn(async () => ({})),
    promoteFromWaitlist: vi.fn(async () => undefined),
    reorderWaitlist: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
  };
  assignments = {
    getEventAssignments: vi.fn(async () => ({})),
    forceDeleteRegistration: vi.fn(async () => undefined),
  };
  // The token IS the user id here; no token at all is the anonymous caller.
  const supabase = {
    service: db.service,
    getAuthUser: vi.fn(async (token: string) => ({ id: token })),
  };
  controller = new RegistrationsController(
    registrations as never,
    assignments as never,
    supabase as never,
    new OrganizationsService(db as never),
  );
});

type Req = { headers: Record<string, string>; cookies: Record<string, string> };

/** A request from `userId`; none = no token. */
function req(userId?: string): Req {
  return { headers: userId ? { authorization: `Bearer ${userId}` } : {}, cookies: {} };
}

const ENTER_ANNA = { personId: ANNA };

interface Route {
  /** The handler's name on the controller. */
  name: string;
  bar: 'read' | 'change';
  /** Addressed by a registration id, so the Event is the registration's own. */
  byEntry: boolean;
  call: (r: Req, entry?: string) => Promise<unknown>;
  /** The service method the route hands over to, and the arguments it must get. */
  reached: () => Mock;
  handed: unknown[];
}

const ROUTES: Route[] = [
  {
    name: 'getAssignments',
    bar: 'read',
    byEntry: false,
    call: (r) => controller.getAssignments(EVENT_A, ANNA, r as never),
    reached: () => assignments.getEventAssignments!,
    handed: [EVENT_A, ANNA, undefined],
  },
  {
    name: 'list',
    bar: 'read',
    byEntry: false,
    call: (r) => controller.list(TOURNAMENT_A, r as never),
    reached: () => registrations.list!,
    handed: [TOURNAMENT_A],
  },
  {
    name: 'listForEvent',
    bar: 'read',
    byEntry: false,
    call: (r) => controller.listForEvent(EVENT_A, r as never),
    reached: () => registrations.listForEvent!,
    handed: [EVENT_A],
  },
  {
    name: 'create',
    bar: 'change',
    byEntry: false,
    call: (r) => controller.create(TOURNAMENT_A, ENTER_ANNA as never, r as never),
    reached: () => registrations.create!,
    handed: [TOURNAMENT_A, ENTER_ANNA],
  },
  {
    name: 'addToWaitlist',
    bar: 'change',
    byEntry: false,
    call: (r) => controller.addToWaitlist(TOURNAMENT_A, ENTER_ANNA as never, r as never),
    reached: () => registrations.addToWaitlist!,
    handed: [TOURNAMENT_A, ENTER_ANNA],
  },
  {
    name: 'reorderWaitlist',
    bar: 'change',
    byEntry: false,
    call: (r) =>
      controller.reorderWaitlist(TOURNAMENT_A, { orderedRegistrationIds: [ENTRY_A] }, r as never),
    reached: () => registrations.reorderWaitlist!,
    handed: [TOURNAMENT_A, [ENTRY_A]],
  },
  {
    name: 'updateStatus',
    bar: 'change',
    byEntry: true,
    call: (r, entry = ENTRY_A) =>
      controller.updateStatus(entry, { status: 'checked_in' } as never, r as never),
    reached: () => registrations.updateStatus!,
    handed: [ENTRY_A, 'checked_in'],
  },
  {
    name: 'promote',
    bar: 'change',
    byEntry: true,
    call: (r, entry = ENTRY_A) => controller.promote(entry, r as never, 'true'),
    reached: () => registrations.promoteFromWaitlist!,
    handed: [ENTRY_A, true],
  },
  {
    name: 'delete',
    bar: 'change',
    byEntry: true,
    call: (r, entry = ENTRY_A) => controller.delete(entry, r as never),
    reached: () => registrations.delete!,
    handed: [ENTRY_A],
  },
  {
    name: 'forceDelete',
    bar: 'change',
    byEntry: true,
    call: (r, entry = ENTRY_A) => controller.forceDelete(entry, r as never),
    reached: () => assignments.forceDeleteRegistration!,
    handed: [ENTRY_A],
  },
];

const READS = ROUTES.filter((route) => route.bar === 'read');
const CHANGES = ROUTES.filter((route) => route.bar === 'change');
const BY_ENTRY = ROUTES.filter((route) => route.byEntry);

describe('RegistrationsController authorization', () => {
  it('covers every handler of the controller', () => {
    // A handler added to the controller and not to ROUTES is checked by nothing.
    const handlers = Object.getOwnPropertyNames(RegistrationsController.prototype).filter(
      (name) => name !== 'constructor' && name !== 'authz',
    );
    expect(handlers.sort()).toEqual(ROUTES.map((route) => route.name).sort());
  });

  it.each(ROUTES)('$name refuses a caller with no token, before any read', async (route) => {
    await expect(route.call(req())).rejects.toBeInstanceOf(UnauthorizedException);
    expect(route.reached()).not.toHaveBeenCalled();
    expect(queriedTables(db.from)).toEqual([]);
  });

  it.each(ROUTES)('$name refuses a signed-in account outside the organisation', async (route) => {
    await expect(route.call(req('u-stranger'))).rejects.toBeInstanceOf(ForbiddenException);
    expect(route.reached()).not.toHaveBeenCalled();
  });

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

  it.each(BY_ENTRY)("$name checks the registration's own Event", async (route) => {
    // Event B's editor, acting on Event A's entry.
    await expect(route.call(req('u-editor-b'), ENTRY_A)).rejects.toBeInstanceOf(ForbiddenException);
    expect(route.reached()).not.toHaveBeenCalled();
  });

  it("checks the tournament's own Event", async () => {
    // Event B's editor, entering Event B's own person into Event A's tournament.
    await expect(
      controller.create(TOURNAMENT_A, { personId: BRUNO } as never, req('u-editor-b') as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(controller.list(TOURNAMENT_A, req('u-editor-b') as never)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(registrations.create).not.toHaveBeenCalled();
    expect(registrations.list).not.toHaveBeenCalled();
  });

  it.each(['create', 'addToWaitlist'] as const)(
    '%s refuses a person who is not on the Event, with one answer whoever asks',
    async (name) => {
      // Event A's editor, an editor of both Events, and an id on no roster at
      // all: the same 400 each time, so the answer tells no one which ids exist.
      const tries = [
        ['u-editor-a', BRUNO],
        ['u-editor-ab', BRUNO],
        ['u-editor-a', NOBODY],
      ] as const;
      for (const [caller, personId] of tries) {
        await expect(
          controller[name](TOURNAMENT_A, { personId } as never, req(caller) as never),
        ).rejects.toBeInstanceOf(BadRequestException);
      }
      expect(registrations[name]).not.toHaveBeenCalled();
    },
  );

  it("reads a person's assignments only under the person's own Event", async () => {
    // Bruno is Event B's; this account owns Event B's organisation, and names
    // Event A in the path, where it may read. The referee half of the report
    // reads every Event, so the path must be the person's.
    await expect(
      controller.getAssignments(EVENT_A, BRUNO, req('u-reader-a') as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    // Event B's editor, asking under Event B about Event A's Anna.
    await expect(
      controller.getAssignments(EVENT_B, ANNA, req('u-editor-b') as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(assignments.getEventAssignments).not.toHaveBeenCalled();
  });

  it('reads each Event from the row that names it', async () => {
    await controller.updateStatus(
      ENTRY_A,
      { status: 'checked_in' } as never,
      req('u-editor-a') as never,
    );
    await controller.create(TOURNAMENT_A, ENTER_ANNA as never, req('u-editor-a') as never);
    // The double hands back the whole row whatever is selected, so the outcome
    // alone would stay green with the column dropped from the read.
    expect(selectsFor(db.from, 'registrations')).toEqual(['tournament_id']);
    expect(new Set(selectsFor(db.from, 'tournaments'))).toEqual(new Set(['event_id']));
    expect(selectsFor(db.from, 'persons')).toEqual(['event_id']);
  });

  it('knows the caller by the session cookie, which is all the admin pages send', async () => {
    const cookieOnly = { ...req(), cookies: { 'sb-access-token': 'u-editor-a' } };
    await controller.delete(ENTRY_A, cookieOnly as never);
    expect(registrations.delete).toHaveBeenCalledWith(ENTRY_A);
  });

  it('refuses a body that names a global profile by `fighterId`', () => {
    // `fighterId` wrote `hemaRatingsId` onto whatever global profile it named.
    // No page sent it; the field is gone (operator ruling 31). The profile a
    // roster person is LINKED to still takes `hemaRatingsId` — that write is the
    // global-persons slice's, not this field's.
    const body = { personId: ANNA, fighterId: BRUNO, hemaRatingsId: '999' };
    expect(CreateRegistrationDto.schema.safeParse(body).success).toBe(false);
  });
});
