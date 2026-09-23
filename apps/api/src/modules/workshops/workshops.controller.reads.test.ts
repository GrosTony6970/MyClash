/**
 * Who may read an Event's workshops board: the workshop list (drafts, capacity
 * and sign-up counts included), one workshop in full, and the break bars.
 *
 * Until 2026-09-23 all three resolved no caller at all, so anyone read a draft
 * Event's workshops. The bar is any member of the Event's organisation, any
 * role (operator ruling 75) — the bar of the Event's instructor list beside
 * them. Platform staff who are not members are refused: RLS also admits a
 * super admin, the ruling does not. Only the organiser's Workshops page calls them;
 * the public site has its own slug routes. A signed-out caller gets 401 before
 * anything is read. Driven through the controller and the real service over
 * seeded tables.
 */
import 'reflect-metadata';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSupabase, queriedTables, selectsFor } from '../../common/testing/supabase-chain';
import { OrganizationsService } from '../organizations/organizations.service';
import { WorkshopsController } from './workshops.controller';
import { WorkshopsService } from './workshops.service';

const EVENT_A = '11111111-1111-4111-8111-111111111111';
const EVENT_B = '22222222-2222-4222-8222-222222222222';
const WORKSHOP_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const WORKSHOP_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const NOBODY = '99999999-9999-4999-8999-999999999999';

let db: ReturnType<typeof mockSupabase>;
let controller: WorkshopsController;

function workshop(id: string, eventId: string) {
  return {
    id,
    event_id: eventId,
    slug: id.slice(0, 4),
    title: `Workshop ${id.slice(0, 4)}`,
    status: 'draft',
    capacity: 12,
    sort_order: 0,
    venues: null,
    workshop_sessions: [],
    workshop_instructors: [],
  };
}

const WORKSHOPS = { rows: [workshop(WORKSHOP_B, EVENT_B), workshop(WORKSHOP_A, EVENT_A)] };

function build(workshops: object = WORKSHOPS) {
  db = mockSupabase({
    events: {
      rows: [
        { id: EVENT_B, organization_id: 'org-b', status: 'published' },
        { id: EVENT_A, organization_id: 'org-a', status: 'draft' },
      ],
    },
    organization_members: {
      rows: [
        { organization_id: 'org-b', user_id: 'u-owner-b', role: 'owner' },
        { organization_id: 'org-a', user_id: 'u-member-a', role: 'read_only' },
      ],
    },
    platform_roles: { rows: [{ user_id: 'u-padmin', role: 'platform_admin' }] },
    workshops,
    workshop_breaks: {
      rows: [
        { id: 'br-b', event_id: EVENT_B, day_index: 0, start_time: '12:00', end_time: '13:00' },
        { id: 'br-a', event_id: EVENT_A, day_index: 0, start_time: '12:00', end_time: '13:00' },
      ],
    },
  });
  // The token IS the user id here; no token at all is the anonymous caller.
  const supabase = {
    service: db.service,
    getAuthUser: vi.fn(async (token: string) => ({ id: token })),
  };
  const orgs = new OrganizationsService(supabase as never);
  const service = new WorkshopsService(
    supabase as never,
    {} as never,
    {} as never,
    orgs,
    {} as never,
    {} as never,
  );
  controller = new WorkshopsController(
    service,
    {} as never,
    supabase as never,
    {} as never,
    {} as never,
    {} as never,
  );
}

beforeEach(() => build());

/** A request from `userId`; none = no token. */
function req(userId?: string) {
  return {
    headers: userId ? { authorization: `Bearer ${userId}` } : {},
    cookies: {},
  } as never;
}

const READS = [
  { handler: 'list', call: (r: never) => controller.list(EVENT_A, r), table: 'workshops' },
  { handler: 'getOne', call: (r: never) => controller.getOne(WORKSHOP_A, r), table: 'workshops' },
  {
    handler: 'listBreaks',
    call: (r: never) => controller.listBreaks(EVENT_A, r),
    table: 'workshop_breaks',
  },
];

describe('WorkshopsController organiser reads (ruling 75)', () => {
  it.each(READS)('$handler refuses a caller with no token, before any read', async (read) => {
    await expect(read.call(req())).rejects.toBeInstanceOf(UnauthorizedException);
    expect(queriedTables(db.from)).toEqual([]);
  });

  it.each(READS)(
    "$handler refuses an outsider, another club's owner and platform staff, with one answer",
    async (read) => {
      const answers: unknown[] = [];
      for (const caller of ['u-stranger', 'u-owner-b', 'u-padmin']) {
        const refusal = await read.call(req(caller)).catch((error: unknown) => error);
        expect(refusal, caller).toBeInstanceOf(ForbiddenException);
        answers.push((refusal as ForbiddenException).getResponse());
      }
      expect(new Set(answers.map((answer) => JSON.stringify(answer))).size).toBe(1);
    },
  );

  it('lets a read-only member of the club read its draft Event’s workshops', async () => {
    const rows = await controller.list(EVENT_A, req('u-member-a'));
    expect(rows.map((row) => row.id)).toEqual([WORKSHOP_A]);
    await expect(controller.getOne(WORKSHOP_A, req('u-member-a'))).resolves.toMatchObject({
      id: WORKSHOP_A,
    });
    const breaks = await controller.listBreaks(EVENT_A, req('u-member-a'));
    expect(breaks.map((row) => row.id)).toEqual(['br-a']);
  });

  it("list and breaks read nothing of the Event before the caller's role", async () => {
    for (const call of [
      () => controller.list(EVENT_A, req('u-owner-b')),
      () => controller.listBreaks(EVENT_A, req('u-owner-b')),
    ]) {
      await call().catch(() => undefined);
    }
    expect(queriedTables(db.from)).not.toContain('workshops');
    expect(queriedTables(db.from)).not.toContain('workshop_breaks');
  });

  it("getOne checks the workshop's OWN Event, not one the caller belongs to", async () => {
    await expect(controller.getOne(WORKSHOP_B, req('u-member-a'))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(controller.getOne(WORKSHOP_B, req('u-owner-b'))).resolves.toMatchObject({
      id: WORKSHOP_B,
    });
  });

  it('getOne answers a failed read of the workshop as a failure, not as "not found"', async () => {
    build({ data: null, error: { message: 'connection reset' } });
    const answer = await controller
      .getOne(WORKSHOP_A, req('u-member-a'))
      .catch((error: unknown) => error);
    expect(answer).toBeInstanceOf(BadRequestException);
  });

  it('getOne answers 404 for a workshop that does not exist', async () => {
    await expect(controller.getOne(NOBODY, req('u-member-a'))).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('reads each deciding column', async () => {
    await controller.getOne(WORKSHOP_A, req('u-member-a'));
    // The double hands back the whole row whatever is selected.
    expect(selectsFor(db.from, 'workshops')[0]).toBe('event_id');
    expect(selectsFor(db.from, 'events')).toEqual(['organization_id']);
    expect(selectsFor(db.from, 'organization_members')).toEqual(['role']);
  });
});
