/**
 * POST /events/:eventId/guest-sessions — a participant picks themselves off the
 * roster and gets a guest cookie. No proof is asked, on purpose (ARCHITECTURE.md
 * §12: most participants stop at Guest, and the venue has no time for more).
 *
 * What it must not do is open a draft Event. A draft is visible to its
 * organisation only, and the roster search that leads here already refuses one
 * (`lookup.controller.ts`). The mint did not, so anyone holding two ids could
 * become a draft Event's fighter and read their schedule through /my-schedule.
 */
import { NotFoundException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  mockSupabase,
  queriedTables,
  selectsFor,
  writesTo,
} from '../../common/testing/supabase-chain';
import { GuestSessionsController } from './guest-sessions.controller';
import { GuestJwtService } from './guest-jwt.service';

const DRAFT = '11111111-1111-4111-8111-111111111111';
const OPEN = '22222222-2222-4222-8222-222222222222';
const ANNA = '33333333-3333-4333-8333-333333333333';
const CARL = '44444444-4444-4444-8444-444444444444';
const NOWHERE = '55555555-5555-4555-8555-555555555555';

function mint(opts: { userId?: string; member?: boolean } = {}) {
  const db = mockSupabase({
    events: {
      rows: [
        { id: DRAFT, status: 'draft', organization_id: 'org-draft', end_date: '2027-05-23' },
        { id: OPEN, status: 'published', organization_id: 'org-open', end_date: '2027-05-23' },
      ],
    },
    persons: {
      rows: [
        { id: ANNA, event_id: DRAFT, given_name: 'Anna', family_name: 'A', email: 'a@x.test' },
        { id: CARL, event_id: OPEN, given_name: 'Carl', family_name: 'C', email: 'c@x.test' },
      ],
    },
    guest_sessions: {
      rows: [],
      returning: { id: 'gs-new', device_label: 'Unknown device', expires_at: '2027-05-30' },
    },
  });
  const getUser = vi.fn(async () => ({ data: { user: opts.userId ? { id: opts.userId } : null } }));
  const supabase = { ...db, anon: { auth: { getUser } } };
  const orgs = {
    assertOrgRole: vi.fn(async () => {
      if (!opts.member) throw new Error('not a member');
    }),
  };
  const config = { getOrThrow: () => 'the-server-guest-secret', get: () => 'test' };
  const controller = new GuestSessionsController(
    supabase as never,
    new GuestJwtService(config as never),
    config as never,
    { recordForGuestSession: vi.fn(async () => undefined) } as never,
    orgs as never,
  );
  const setCookie = vi.fn();
  const send = vi.fn();
  const reply = { setCookie, status: vi.fn(() => ({ send })) };
  return { controller, db, orgs, reply, setCookie, send };
}

const anonymous = { headers: {}, cookies: {} } as never;
const signedIn = { headers: { authorization: 'Bearer t' }, cookies: {} } as never;

afterEach(() => vi.clearAllMocks());

describe('POST /events/:eventId/guest-sessions', () => {
  it('refuses a draft Event to anyone outside its organisation, before it reads the roster or opens a session', async () => {
    for (const [caller, opts] of [
      [anonymous, {}],
      [signedIn, { userId: 'u-outsider', member: false }],
    ] as const) {
      const t = mint(opts);
      const refusal = t.controller.create(DRAFT, { person_id: ANNA }, caller, t.reply as never);
      await expect(refusal).rejects.toBeInstanceOf(NotFoundException);
      await expect(refusal).rejects.toThrow(`Event "${DRAFT}" not found`);
      expect(queriedTables(t.db.from)).toEqual(['events']);
      expect(writesTo(t.db, 'guest_sessions')).toEqual([]);
      expect(t.setCookie).not.toHaveBeenCalled();
      // The double ignores the projection: without `status` a draft reads as open.
      expect(selectsFor(t.db.from, 'events')).toEqual(['status, organization_id, end_date']);
    }
  });

  it('answers an Event id that matches nothing exactly as a hidden one, so no draft is confirmed', async () => {
    const t = mint();
    const refusal = t.controller.create(NOWHERE, { person_id: CARL }, anonymous, t.reply as never);
    await expect(refusal).rejects.toBeInstanceOf(NotFoundException);
    await expect(refusal).rejects.toThrow(`Event "${NOWHERE}" not found`);
    expect(queriedTables(t.db.from)).toEqual(['events']);
  });

  it("lets a member of the draft Event's organisation pick a person, as the caller they signed in as", async () => {
    const t = mint({ userId: 'u-organiser', member: true });
    await t.controller.create(DRAFT, { person_id: ANNA }, signedIn, t.reply as never);
    expect(t.orgs.assertOrgRole).toHaveBeenCalledWith('org-draft', 'u-organiser', 'read_only');
    expect(t.setCookie).toHaveBeenCalledTimes(1);
  });

  it('opens a guest session on an open Event for anyone, as before', async () => {
    const t = mint();
    await t.controller.create(OPEN, { person_id: CARL }, anonymous, t.reply as never);
    expect(writesTo(t.db, 'guest_sessions')).toHaveLength(1);
    expect(t.setCookie).toHaveBeenCalledTimes(1);
    expect(t.send.mock.calls[0]?.[0]).toMatchObject({ person: { id: CARL } });
    // Until the Event's end + 7 days, from the same Event read as the gate.
    const written = writesTo(t.db, 'guest_sessions')[0]?.row as { expires_at?: string };
    expect(written?.expires_at).toBe('2027-05-30T00:00:00.000Z');
  });
});
