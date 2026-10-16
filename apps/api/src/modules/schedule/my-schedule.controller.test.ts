/**
 * GET /events/:eventId/my-schedule on a draft or test Event (operator ruling 2026-10-16).
 *
 * A guest of a hidden Event saw her bouts here, and each bout's own page said "not found".
 * The ruling: the schedule is hidden too, as every other page of that Event is. Its club and
 * its active staff still read it.
 */
import { ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockSupabase, queriedTables, selectsFor } from '../../common/testing/supabase-chain';
import { MyScheduleController } from './my-schedule.controller';

const DRAFT = '11111111-1111-4111-8111-111111111111';
const TEST = '22222222-2222-4222-8222-222222222222';
const OPEN = '33333333-3333-4333-8333-333333333333';
const LEA = '44444444-4444-4444-8444-444444444444';

function door(opts: { member?: boolean } = {}) {
  const db = mockSupabase({
    events: {
      rows: [
        { id: DRAFT, status: 'draft', organization_id: 'org-1', event_kind: 'standard' },
        { id: TEST, status: 'published', organization_id: 'org-1', event_kind: 'test' },
        { id: OPEN, status: 'published', organization_id: 'org-1', event_kind: 'standard' },
      ],
    },
    event_staff_accounts: { rows: [{ id: 'staff-1', event_id: DRAFT, status: 'active' }] },
  });
  const schedule = { getSchedule: vi.fn(async () => ({ personId: LEA, matches: [] })) };
  const identity = { requirePersonId: vi.fn(async () => LEA) };
  const orgs = {
    assertOrgRole: vi.fn(async () => {
      if (!opts.member) throw new ForbiddenException('not a member');
    }),
  };
  const controller = new MyScheduleController(
    schedule as never,
    db as never,
    identity as never,
    orgs as never,
  );
  return { controller, db, schedule, identity, orgs };
}

/** Léa's guest cookie: the identity is resolved by the service, not by the gate. */
const guest = { headers: {}, cookies: { mc_guest: 'cookie' } } as never;
const signedInAs = (userId: string) =>
  ({ headers: {}, cookies: {}, identity: { kind: 'claimed', userId, email: null } }) as never;

afterEach(() => vi.clearAllMocks());

describe('GET /events/:eventId/my-schedule', () => {
  it('answers a draft or a test Event to its guest as an unknown Event, before it asks who she is', async () => {
    for (const event of [DRAFT, TEST]) {
      const t = door();
      const read = t.controller.getMySchedule(event, guest);
      await expect(read).rejects.toBeInstanceOf(NotFoundException);
      await expect(read).rejects.toThrow(`Event "${event}" not found`);
      expect(t.identity.requirePersonId).not.toHaveBeenCalled();
      expect(t.schedule.getSchedule).not.toHaveBeenCalled();
      expect(queriedTables(t.db.from)).toEqual(['events']);
      // The double ignores the projection: without `status` a draft reads as open.
      expect(selectsFor(t.db.from, 'events')).toEqual(['status, organization_id, event_kind']);
    }
  });

  it('reads a hidden Event for a member of its club', async () => {
    const t = door({ member: true });
    await expect(t.controller.getMySchedule(DRAFT, signedInAs('u-1'))).resolves.toMatchObject({
      personId: LEA,
    });
    expect(t.orgs.assertOrgRole).toHaveBeenCalledWith('org-1', 'u-1', 'read_only');
    expect(t.schedule.getSchedule).toHaveBeenCalledWith(DRAFT, LEA, LEA);
  });

  it("reads a hidden Event for the Event's active staff session", async () => {
    const t = door();
    const staff = { headers: {}, staffSession: { staffId: 'staff-1', eventId: DRAFT } };
    await t.controller.getMySchedule(DRAFT, staff as never);
    expect(t.schedule.getSchedule).toHaveBeenCalledWith(DRAFT, LEA, LEA);
  });

  it('answers a login whose hour is up 401 before it reads any Event, so the browser renews it', async () => {
    // The guard verified nothing: in shadow mode the request goes on as a stranger's.
    const ended = { headers: {}, cookies: { 'sb-access-token': 'ended' } } as never;
    for (const event of [DRAFT, OPEN, 'no-such-event']) {
      const t = door({ member: true });
      await expect(t.controller.getMySchedule(event, ended)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(queriedTables(t.db.from)).toEqual([]);
    }
  });

  it('answers an ended login sent as a Bearer header 401 too', async () => {
    const t = door({ member: true });
    const ended = { headers: { authorization: 'Bearer ended' }, cookies: {} } as never;
    await expect(t.controller.getMySchedule(DRAFT, ended)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('answers a stranger with no login, or an empty one, as an unknown Event on a hidden Event', async () => {
    for (const cookies of [{}, { 'sb-access-token': '' }]) {
      const t = door();
      const stranger = { headers: {}, cookies } as never;
      await expect(t.controller.getMySchedule(DRAFT, stranger)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    }
  });

  it('reads a hidden Event for its staff session whose device also holds an ended login', async () => {
    const t = door();
    const staff = {
      headers: {},
      cookies: { 'sb-access-token': 'ended', mc_staff: 'pin' },
      identity: { kind: 'staff', staffId: 'staff-1', eventId: DRAFT },
      staffSession: { staffId: 'staff-1', eventId: DRAFT },
    };
    await t.controller.getMySchedule(DRAFT, staff as never);
    expect(t.schedule.getSchedule).toHaveBeenCalledWith(DRAFT, LEA, LEA);
  });

  it('reads a guest whose old login cookie is still there by her guest session', async () => {
    const t = door();
    const both = {
      headers: {},
      cookies: { 'sb-access-token': 'ended', mc_guest: 'cookie' },
      identity: { kind: 'guest', guestSessionId: 'g-1', personId: LEA, eventId: OPEN },
    } as never;
    await t.controller.getMySchedule(OPEN, both);
    expect(t.schedule.getSchedule).toHaveBeenCalledWith(OPEN, LEA, LEA);
  });

  it('reads an open Event for its guest, as before', async () => {
    const t = door();
    await t.controller.getMySchedule(OPEN, guest);
    expect(t.identity.requirePersonId).toHaveBeenCalledWith(guest, OPEN);
    expect(t.schedule.getSchedule).toHaveBeenCalledWith(OPEN, LEA, LEA);
  });
});
