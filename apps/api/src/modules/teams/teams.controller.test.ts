/**
 * Who may read and change a Tournament's teams: the Registrations' two bars. Reading needs
 * membership of the Event's organisation at any role; changing needs `editor`. Both are checked on
 * the Tournament of the URL, read from its row (the service then holds each team id to that
 * Tournament: `teams.service.test.ts`).
 *
 * Driven through the controller and the real org-role check over seeded tables. The service is a
 * stub, so "refused" means "never reached".
 */
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { BLOCK_ON_COMPLETED_EVENT_KEY } from '../../common/event-readonly/block-on-completed.decorator';
import { NO_UPLOAD } from '../../common/read-upload';
import { mockSupabase, queriedTables, selectsFor } from '../../common/testing/supabase-chain';
import { OrganizationsService } from '../organizations/organizations.service';
import { CreateTeamDto, UpdateTeamDto } from './dto/teams.dto';
import { TeamsController } from './teams.controller';

const EVENT_A = '11111111-1111-4111-8111-111111111111';
const EVENT_B = '22222222-2222-4222-8222-222222222222';
const TOURNAMENT_A = '55555555-5555-4555-8555-555555555555';
const TOURNAMENT_B = '66666666-6666-4666-8666-666666666666';
const LYON = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

let db: ReturnType<typeof mockSupabase>;
let teams: Record<string, Mock>;
let controller: TeamsController;

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
    organization_members: {
      rows: [
        { organization_id: 'org-b', user_id: 'u-editor-b', role: 'editor' },
        { organization_id: 'org-a', user_id: 'u-editor-a', role: 'editor' },
        // Owner elsewhere, read-only here.
        { organization_id: 'org-b', user_id: 'u-reader-a', role: 'owner' },
        { organization_id: 'org-a', user_id: 'u-reader-a', role: 'read_only' },
      ],
    },
  });
  teams = {
    list: vi.fn(async () => []),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    remove: vi.fn(async () => undefined),
    uploadLogo: vi.fn(async () => ({ url: 'u' })),
  };
  // The token IS the user id here; no token at all is the anonymous caller.
  const supabase = {
    service: db.service,
    getAuthUser: vi.fn(async (token: string) => ({ id: token })),
  };
  controller = new TeamsController(
    teams as never,
    supabase as never,
    new OrganizationsService(db as never),
  );
});

/** A request from `userId`; none = no token. It carries no file. */
function req(userId?: string) {
  return {
    headers: userId ? { authorization: `Bearer ${userId}` } : {},
    cookies: {},
    file: async () => undefined,
  } as never;
}

const CREATE = { name: 'Lyon Blades' } as CreateTeamDto;
const SAVE = { size: 4 } as UpdateTeamDto;

interface Route {
  name: string;
  bar: 'read' | 'change';
  call: (r: never, tournament?: string) => Promise<unknown>;
  handed: unknown[];
}

const ROUTES: Route[] = [
  {
    name: 'list',
    bar: 'read',
    call: (r, t = TOURNAMENT_A) => controller.list(t, r),
    handed: [TOURNAMENT_A],
  },
  {
    name: 'create',
    bar: 'change',
    call: (r, t = TOURNAMENT_A) => controller.create(t, CREATE, r),
    handed: [TOURNAMENT_A, CREATE],
  },
  {
    name: 'update',
    bar: 'change',
    call: (r, t = TOURNAMENT_A) => controller.update(t, LYON, SAVE, r),
    handed: [TOURNAMENT_A, LYON, SAVE],
  },
  {
    name: 'remove',
    bar: 'change',
    call: (r, t = TOURNAMENT_A) => controller.remove(t, LYON, r),
    handed: [TOURNAMENT_A, LYON],
  },
  {
    name: 'uploadLogo',
    bar: 'change',
    call: (r, t = TOURNAMENT_A) => controller.uploadLogo(t, LYON, r),
    handed: [TOURNAMENT_A, LYON, NO_UPLOAD],
  },
];
const READS = ROUTES.filter((route) => route.bar === 'read');
const CHANGES = ROUTES.filter((route) => route.bar === 'change');
const reached = (route: Route) => teams[route.name]!;

describe('TeamsController authorization', () => {
  it('covers every handler of the controller', () => {
    const handlers = Object.getOwnPropertyNames(TeamsController.prototype).filter(
      (name) => !['constructor', 'authz', 'assertEditor'].includes(name),
    );
    expect(handlers.sort()).toEqual(ROUTES.map((route) => route.name).sort());
  });

  it.each(ROUTES)('$name refuses a caller with no token, before any read', async (route) => {
    await expect(route.call(req())).rejects.toBeInstanceOf(UnauthorizedException);
    expect(reached(route)).not.toHaveBeenCalled();
    expect(queriedTables(db.from)).toEqual([]);
  });

  it.each(ROUTES)('$name refuses a signed-in account outside the organisation', async (route) => {
    await expect(route.call(req('u-stranger'))).rejects.toBeInstanceOf(ForbiddenException);
    expect(reached(route)).not.toHaveBeenCalled();
  });

  it.each(READS)('$name lets any member of the organisation read', async (route) => {
    await route.call(req('u-reader-a'));
    expect(reached(route)).toHaveBeenCalledWith(...route.handed);
  });

  it.each(CHANGES)('$name refuses a read-only member', async (route) => {
    await expect(route.call(req('u-reader-a'))).rejects.toBeInstanceOf(ForbiddenException);
    expect(reached(route)).not.toHaveBeenCalled();
  });

  it.each(ROUTES)(
    '$name lets an editor of the Event through, with the ids it was sent',
    async (route) => {
      await route.call(req('u-editor-a'));
      expect(reached(route)).toHaveBeenCalledWith(...route.handed);
      expect(selectsFor(db.from, 'tournaments')).toEqual(['event_id']);
    },
  );

  it.each(ROUTES)("$name checks the Tournament's own Event", async (route) => {
    // Event B's editor, on Event A's Tournament.
    await expect(route.call(req('u-editor-b'), TOURNAMENT_A)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(reached(route)).not.toHaveBeenCalled();
  });

  it('refuses every write once the Event is completed, and leaves the read open', () => {
    const marked = (name: string) =>
      new Reflector().get<boolean>(
        BLOCK_ON_COMPLETED_EVENT_KEY,
        (TeamsController.prototype as unknown as Record<string, () => unknown>)[name]!,
      ) === true;
    expect(CHANGES.map((route) => [route.name, marked(route.name)])).toEqual(
      CHANGES.map((route) => [route.name, true]),
    );
    expect(marked('list')).toBe(false);
  });
});

describe('the team bodies', () => {
  it('take a name of 1 to 120 characters once trimmed, a size of 1 to 10, a seed of 1 or more', () => {
    const ok = (body: unknown) => CreateTeamDto.schema.safeParse(body).success;
    expect(ok({ name: 'Lyon', size: 10, seed: 1, color: 'red' })).toBe(true);
    expect(ok({ name: '   ' })).toBe(false);
    expect(ok({ name: 'x'.repeat(121) })).toBe(false);
    expect(ok({ name: 'Lyon', size: 11 })).toBe(false);
    expect(ok({ name: 'Lyon', size: 0 })).toBe(false);
    expect(ok({ name: 'Lyon', seed: 0 })).toBe(false);
    expect(ok({ name: 'Lyon', color: 'x'.repeat(33) })).toBe(false);
    // No logo on create: it comes through the upload route.
    expect(ok({ name: 'Lyon', logoUrl: 'https://x' })).toBe(false);
  });

  it('take a logo on save only as null, to remove it', () => {
    const ok = (body: unknown) => UpdateTeamDto.schema.safeParse(body).success;
    expect(ok({ logoUrl: null })).toBe(true);
    expect(ok({ logoUrl: 'https://elsewhere/logo.png' })).toBe(false);
    expect(ok({ seed: null, color: null })).toBe(true);
  });
});
