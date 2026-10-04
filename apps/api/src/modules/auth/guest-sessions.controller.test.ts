/**
 * POST /events/:eventId/guest-sessions — a participant picks themselves off the
 * roster and gets a guest cookie. No proof is asked, on purpose (ARCHITECTURE.md
 * §12: most participants stop at Guest, and the venue has no time for more).
 *
 * What it must not do is open a draft Event. A draft is visible to its club and
 * its active staff sessions only, and the roster search that leads here already
 * refuses one (`lookup.controller.ts`). The mint did not, so anyone holding two ids
 * could become a draft Event's fighter and read their schedule through /my-schedule.
 */
import { ForbiddenException, NotFoundException } from '@nestjs/common';
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
const TOM = '66666666-6666-4666-8666-666666666666';

/** A roster row; `account` is the account that holds it, if any. */
const person = (id: string, event: string, name: string, account: string | null = null) => ({
  id,
  event_id: event,
  given_name: name,
  family_name: name[0],
  email: `${name.toLowerCase()}@x.test`,
  claimed_by_user_id: account,
});

function mint(opts: { member?: boolean } = {}) {
  const db = mockSupabase({
    events: {
      rows: [
        { id: DRAFT, status: 'draft', organization_id: 'org-draft', end_date: '2027-05-23' },
        { id: OPEN, status: 'published', organization_id: 'org-open', end_date: '2027-05-23' },
      ],
    },
    persons: {
      rows: [
        person(ANNA, DRAFT, 'Anna'),
        person(CARL, OPEN, 'Carl'),
        // Tom has an account: his name is not a guest's to pick (ruling 265).
        person(TOM, OPEN, 'Tom', 'tom-account'),
      ],
    },
    guest_sessions: {
      rows: [],
      returning: { id: 'gs-new', device_label: 'Unknown device', expires_at: '2027-05-30' },
    },
    // No Tournament: the draft-only entrant is guest-sessions.drafts.test.ts's case.
    tournaments: { rows: [] },
    event_staff_accounts: { rows: [{ id: 'staff-draft', event_id: DRAFT, status: 'active' }] },
  });
  const orgs = {
    assertOrgRole: vi.fn(async () => {
      if (!opts.member) throw new ForbiddenException('not a member');
    }),
  };
  const config = { getOrThrow: () => 'the-server-guest-secret', get: () => 'test' };
  const controller = new GuestSessionsController(
    db as never,
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
/** The login as the AuthGuard verified it: the Event gate reads it from the request. */
const signedInAs = (userId: string) =>
  ({
    headers: { authorization: 'Bearer t' },
    cookies: {},
    identity: { kind: 'claimed', userId, email: null },
  }) as never;

afterEach(() => vi.clearAllMocks());

describe('POST /events/:eventId/guest-sessions', () => {
  it('refuses a draft Event to anyone outside its organisation, before it reads the roster or opens a session', async () => {
    for (const [caller, opts] of [
      [anonymous, {}],
      [signedInAs('u-outsider'), { member: false }],
    ] as const) {
      const t = mint(opts);
      const refusal = t.controller.create(DRAFT, { person_id: ANNA }, caller, t.reply as never);
      await expect(refusal).rejects.toBeInstanceOf(NotFoundException);
      await expect(refusal).rejects.toThrow(`Event "${DRAFT}" not found`);
      expect(queriedTables(t.db.from)).toEqual(['events']);
      expect(writesTo(t.db, 'guest_sessions')).toEqual([]);
      expect(t.setCookie).not.toHaveBeenCalled();
      // The double ignores the projection: without `status` a draft reads as open.
      expect(selectsFor(t.db.from, 'events')).toEqual(['status, organization_id, event_kind']);
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
    const t = mint({ member: true });
    await t.controller.create(
      DRAFT,
      { person_id: ANNA },
      signedInAs('u-organiser'),
      t.reply as never,
    );
    expect(t.orgs.assertOrgRole).toHaveBeenCalledWith('org-draft', 'u-organiser', 'read_only');
    expect(t.setCookie).toHaveBeenCalledTimes(1);
  });

  it("lets the draft Event's active staff session pick a person", async () => {
    const t = mint();
    const staff = { headers: {}, staffSession: { staffId: 'staff-draft', eventId: DRAFT } };
    await t.controller.create(DRAFT, { person_id: ANNA }, staff as never, t.reply as never);
    expect(t.setCookie).toHaveBeenCalledTimes(1);
  });

  it('opens a guest session on an open Event for anyone, as before', async () => {
    const t = mint();
    await t.controller.create(OPEN, { person_id: CARL }, anonymous, t.reply as never);
    expect(writesTo(t.db, 'guest_sessions')).toHaveLength(1);
    expect(t.setCookie).toHaveBeenCalledTimes(1);
    expect(t.send.mock.calls[0]?.[0]).toMatchObject({ person: { id: CARL } });
    // Until the Event's end + 7 days, read once the gate let the caller in.
    const written = writesTo(t.db, 'guest_sessions')[0]?.row as { expires_at?: string };
    expect(written?.expires_at).toBe('2027-05-30T00:00:00.000Z');
    expect(selectsFor(t.db.from, 'events')).toEqual([
      'status, organization_id, event_kind',
      'end_date',
    ]);
    // What the pick answers with, and nothing more: no email.
    expect(selectsFor(t.db.from, 'persons')).toEqual([
      'id, given_name, family_name, claim_status, claimed_by_user_id',
    ]);
  });

  it('refuses the name an account holds, by a code, and opens nothing (ruling 265)', async () => {
    const t = mint();

    const refusal = await t.controller
      .create(OPEN, { person_id: TOM }, anonymous, t.reply as never)
      .catch((err: unknown) => err);

    expect(refusal).toBeInstanceOf(ForbiddenException);
    expect((refusal as ForbiddenException).getResponse()).toEqual({
      error: 'PersonHasAccount',
      message: 'This participant has an account. Sign in to continue.',
    });
    expect(writesTo(t.db, 'guest_sessions')).toEqual([]);
    expect(t.setCookie).not.toHaveBeenCalled();
  });

  it('answers with no word about the account of the person picked', async () => {
    const t = mint();
    await t.controller.create(OPEN, { person_id: CARL }, anonymous, t.reply as never);
    expect(Object.keys((t.send.mock.calls[0]?.[0] as { person: object }).person).sort()).toEqual([
      'claim_status',
      'family_name',
      'given_name',
      'id',
    ]);
  });
});
