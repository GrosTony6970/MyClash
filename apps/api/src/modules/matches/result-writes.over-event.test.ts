import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { mockSupabase } from '../../common/testing/supabase-chain';
import { PenaltiesController } from '../penalties/penalties.controller';
import { PenaltiesService } from '../penalties/penalties.service';
import { BracketSlotsController } from '../phases/bracket-slots.controller';
import { STAFF_COOKIE_NAME, StaffService } from '../staff/staff.service';
import { FrozenResultsGuard } from './frozen-results.guard';
import { MatchesController } from './matches.controller';
import { MatchesService } from './matches.service';

/**
 * Who reaches a result write once the Event is over (rulings 249 to 252).
 *
 * The REAL controllers and the REAL "who may score" run here. "Who may score"
 * refused everybody on an over Event, a super admin included, so the
 * corrections of rulings 222a and 231 were proven on the services and
 * unreachable over HTTP.
 *
 * - 249: a hit's void, restore and edit and a card's void reach their handler
 *   for an ACCOUNT. A pad stays refused there.
 * - 250: every other result write stays closed for everybody.
 * - 251: there a super admin needs no role in the club.
 * - 252: the bracket slot override stays open on a completed Event.
 */
const ORG = 'org-1';
const EVENT = 'event-1';
const MATCH = 'm1';
const SLOT = 'slot-1';
const USER = 'a0000000-0000-4000-8000-000000000001';
const CLOSED = /not open for staff scoring/i;
const FROZEN = new ConflictException({
  message: 'Event results are frozen',
  code: 'event_results_frozen',
});

type Over = 'completed' | 'archived';
/**
 * A super admin with no role in the club, a member who holds every role of the
 * club, a member who is a scorekeeper only, an account that is none of them, a
 * pad's PIN session.
 */
type Caller = 'super admin' | 'member' | 'scorekeeper' | 'stranger' | 'pad';
const OVER: Over[] = ['completed', 'archived'];

/** One locked bout of one Event: a live hit, a voided hit, a card, a forfeit. */
function database(status: string, caller: Caller) {
  return mockSupabase({
    exchanges: {
      rows: [
        { id: 'hit-live', match_id: MATCH, voided: false, sequence: 1 },
        { id: 'hit-voided', match_id: MATCH, voided: true, sequence: 2 },
      ],
    },
    match_penalties: { rows: [{ id: 'card-1', match_id: MATCH, voided: false }] },
    match_forfeits: { rows: [{ id: 'forfeit-1', match_id: MATCH }] },
    matches: {
      rows: [
        {
          id: MATCH,
          lice_id: 'lice-1',
          phase_id: 'phase-1',
          locked_at: '2026-10-03T20:00:00.000Z',
          phases: {
            tournaments: {
              id: 'tournament-1',
              event_id: EVENT,
              lock_config_json: null,
              events: { organization_id: ORG, status },
            },
          },
        },
      ],
    },
    bracket_slots: { rows: [{ id: SLOT, phase_id: 'phase-1' }] },
    phases: { rows: [{ id: 'phase-1', tournament_id: 'tournament-1' }] },
    tournaments: {
      rows: [{ id: 'tournament-1', event_id: EVENT, penalty_ruleset_id: 'ruleset-1' }],
    },
    events: { rows: [{ id: EVENT, organization_id: ORG, status, end_date: '2026-10-03' }] },
    platform_roles: {
      rows: caller === 'super admin' ? [{ user_id: USER, role: 'super_admin' }] : [],
    },
    exchange_edit_requests: { rows: [], returning: { id: 'request-1' } },
    audit_log: { rows: [] },
    match_events: { rows: [] },
    event_staff_accounts: {
      rows: [{ id: 'staff-1', event_id: EVENT, status: 'active', role: 'scoring' }],
    },
    event_staff_lice_assignments: {
      rows: [{ id: 'assignment-1', staff_account_id: 'staff-1', lice_id: 'lice-1' }],
    },
  });
}

/** A service whose every method is a spy that answers `reached` and keeps its last argument. */
function spies() {
  const calls: string[] = [];
  const actors: unknown[] = [];
  const service = new Proxy(
    {},
    {
      get: (_target, name: string) =>
        vi.fn(async (...args: unknown[]) => {
          calls.push(name);
          actors.push(args.at(-1));
          return 'reached';
        }),
    },
  );
  return { calls, actors, service };
}

function setup(status: string, caller: Caller) {
  const db = database(status, caller);
  // A member holds every role of the club, a scorekeeper that one alone.
  const held = (role: string) =>
    caller === 'member' || (caller === 'scorekeeper' && role === 'scorekeeper');
  const assertOrgRole = vi.fn(async (_org: string, _user: string, role: string) => {
    if (!held(role)) throw new ForbiddenException('Not a member of this organization');
  });
  const orgs = { assertOrgRole };
  const staff = new StaffService(
    db as never,
    orgs as never,
    { verify: () => ({ sub: 'staff-1', event_id: EVENT, type: 'staff' }) } as never,
    {} as never,
  );
  vi.spyOn(
    staff as never as { getSupabaseUserId: () => Promise<string | null> },
    'getSupabaseUserId',
  ).mockResolvedValue(caller === 'pad' ? null : USER);

  const req = (caller === 'pad'
    ? { cookies: { [STAFF_COOKIE_NAME]: 'token' }, headers: {} }
    : { cookies: {}, headers: { authorization: 'Bearer token' } }) as unknown as FastifyRequest;
  return { db, orgs, staff, req };
}

/** The controllers over spies: a door that is reached says so. */
function doors(status: string, caller: Caller) {
  const { db, orgs, staff, req } = setup(status, caller);
  const { calls, actors, service } = spies();
  const matches = new MatchesController(
    service as never,
    service as never,
    service as never,
    staff,
    service as never,
    service as never,
    db as never,
    orgs as never,
  );
  const slots = new BracketSlotsController(
    service as never,
    { ...db, getAuthUser: async () => ({ id: USER }) } as never,
    orgs as never,
  );
  return { calls, actors, matches, slots, req };
}

/** The controllers over the REAL handlers of a hit and of a card. */
function chain(status: string, caller: Caller) {
  const { db, orgs, staff, req } = setup(status, caller);
  const frozen = new FrozenResultsGuard(db as never, {} as never);
  const scoring = { recomputeMatchScore: vi.fn(), assertCorrectionLands: vi.fn() };
  const matches = new MatchesController(
    new MatchesService(
      db as never,
      scoring as never,
      {} as never,
      {} as never,
      {} as never,
      frozen,
    ),
    {} as never,
    {} as never,
    staff,
    {} as never,
    {} as never,
    db as never,
    orgs as never,
  );
  const penalties = new PenaltiesController(
    new PenaltiesService(db as never, scoring as never, frozen, orgs as never),
    db as never,
    staff,
    orgs as never,
  );
  const changed = (table: string) =>
    db.writes.filter((write) => write.table === table).map((write) => write.row);
  return { changed, scoring, matches, penalties, req };
}

type Chain = ReturnType<typeof chain>;
type Doors = ReturnType<typeof doors>;
const reply = { status: vi.fn() } as unknown as FastifyReply;
const REASON = { reason: 'the video shows no hit' };

const voidHit = (c: Chain) => c.matches.voidExchange('hit-live', REASON as never, c.req, reply);
const restoreHit = (c: Chain) => c.matches.revertVoidExchange('hit-voided', c.req, reply);
const editHit = (c: Chain) => c.matches.editExchange('hit-live', REASON as never, c.req);
const voidCard = (c: Chain) => c.penalties.voidPenalty('card-1', REASON as never, c.req);

describe('a correction on an over Event (rulings 249, 251)', () => {
  it.each(OVER)('a super admin with no role in the club voids a hit (%s)', async (status) => {
    const c = chain(status, 'super admin');
    await voidHit(c);
    expect(c.changed('exchanges')).toEqual([{ voided: true, voided_reason: REASON.reason }]);
    // No request is filed: the one write closes the requests the void answers (ruling 253).
    expect(c.changed('exchange_edit_requests')).toMatchObject([{ status: 'approved' }]);
    expect(c.scoring.assertCorrectionLands).toHaveBeenCalledWith(MATCH, {
      dropExchangeIds: ['hit-live'],
    });
    expect(c.scoring.recomputeMatchScore).toHaveBeenCalledWith(MATCH);
  });

  it.each(OVER)('a super admin with no role restores a voided hit (%s)', async (status) => {
    const c = chain(status, 'super admin');
    await restoreHit(c);
    expect(c.changed('exchanges')).toEqual([{ voided: false, voided_reason: null }]);
    expect(c.scoring.recomputeMatchScore).toHaveBeenCalledWith(MATCH);
  });

  it.each(OVER)('a super admin with no role voids a card (%s)', async (status) => {
    const c = chain(status, 'super admin');
    await voidCard(c);
    expect(c.changed('match_penalties')).toEqual([{ voided: true, voided_reason: REASON.reason }]);
    expect(c.scoring.recomputeMatchScore).toHaveBeenCalledWith(MATCH);
  });

  it.each(OVER)('a super admin with no role reaches a hit’s edit (%s)', async (status) => {
    const d = doors(status, 'super admin');
    await d.matches.editExchange('hit-live', REASON as never, d.req);
    expect(d.actors).toEqual([{ userId: USER, canOverrideLocked: true, correctsOverEvent: true }]);
  });

  it.each(OVER)('a super admin with no role reaches a new hit (%s)', async (status) => {
    const d = doors(status, 'super admin');
    await d.matches.createExchange(MATCH, {} as never, d.req);
    expect(d.actors).toEqual([{ userId: USER, canOverrideLocked: true, correctsOverEvent: true }]);
  });

  // The handler asked the club's role a second time; the next refusal is the body's.
  it.each(OVER)('a super admin with no role reaches a new card (%s)', async (status) => {
    const c = chain(status, 'super admin');
    await expect(c.penalties.createPenalty(MATCH, {} as never, c.req)).rejects.toThrow(
      /Either rulesetEntryId or directCard is required/,
    );
  });

  it.each(OVER)('a member’s void of a hit becomes a request (%s)', async (status) => {
    const c = chain(status, 'member');
    await expect(voidHit(c)).resolves.toEqual({
      pendingReview: true,
      requestId: 'request-1',
      status: 'pending',
    });
    expect(c.changed('exchanges')).toEqual([]);
    expect(c.changed('exchange_edit_requests')).toMatchObject([
      {
        event_id: EVENT,
        match_id: MATCH,
        exchange_id: 'hit-live',
        requested_by_user_id: USER,
        request_type: 'void_exchange',
        reason: REASON.reason,
        status: 'pending',
      },
    ]);
    expect(c.scoring.recomputeMatchScore).not.toHaveBeenCalled();
  });

  it.each(OVER)('a member’s restore of a hit becomes a request (%s)', async (status) => {
    const c = chain(status, 'member');
    await expect(restoreHit(c)).resolves.toMatchObject({ pendingReview: true });
    expect(c.changed('exchanges')).toEqual([]);
    expect(c.changed('exchange_edit_requests')).toMatchObject([
      { exchange_id: 'hit-voided', request_type: 'revert_void_exchange' },
    ]);
  });

  it.each(OVER)('a member’s edit of a hit and void of a card are refused (%s)', async (status) => {
    for (const send of [editHit, voidCard]) {
      const c = chain(status, 'member');
      await expect(send(c)).rejects.toEqual(FROZEN);
      expect(c.changed('exchanges')).toEqual([]);
      expect(c.changed('match_penalties')).toEqual([]);
    }
  });

  // The lock is asked before the Event: who cannot pass it files no request.
  it.each(OVER)('a scorekeeper is stopped by the lock of the bout (%s)', async (status) => {
    for (const send of [voidHit, restoreHit, editHit, voidCard]) {
      const c = chain(status, 'scorekeeper');
      await expect(send(c)).rejects.toThrow(/locked/i);
      expect(c.changed('exchange_edit_requests')).toEqual([]);
      expect(c.changed('exchanges')).toEqual([]);
      expect(c.changed('match_penalties')).toEqual([]);
    }
  });

  it.each(OVER)('a pad stays refused at every one of the four (%s)', async (status) => {
    for (const send of [voidHit, restoreHit, editHit, voidCard]) {
      const c = chain(status, 'pad');
      await expect(send(c)).rejects.toThrow(CLOSED);
    }
  });

  it('an account that is neither is refused, with the code of "no role"', async () => {
    for (const send of [voidHit, restoreHit, editHit, voidCard]) {
      const c = chain('completed', 'stranger');
      await expect(send(c)).rejects.toMatchObject({
        response: { message: 'Not a member of this organization', code: 'account_cannot_score' },
      });
      expect(c.changed('exchange_edit_requests')).toEqual([]);
    }
  });

  it('on a running Event a super admin still needs a role in the club', async () => {
    for (const send of [voidHit, restoreHit, editHit, voidCard]) {
      const c = chain('running', 'super admin');
      await expect(send(c)).rejects.toMatchObject({ response: { code: 'account_cannot_score' } });
      expect(c.changed('exchanges')).toEqual([]);
      expect(c.changed('match_penalties')).toEqual([]);
    }
  });
});

type Door = [string, (d: Doors) => Promise<unknown>];

/** Every other result write: closed for everybody on an over Event (ruling 250). */
const CLOSED_DOORS: Door[] = [
  [
    'a bout set to completed with a winner',
    (d) => d.matches.updateStatus(MATCH, { status: 'completed' } as never, d.req),
  ],
  ['the clock ended', (d) => d.matches.clockAction(MATCH, { action: 'end' } as never, d.req)],
  ['a round ended on time', (d) => d.matches.endRound(MATCH, d.req)],
  ['a round advanced', (d) => d.matches.advanceRound(MATCH, {}, d.req)],
  ['the colours swapped', (d) => d.matches.swapFighterColor(MATCH, d.req)],
  ['a bout reset', (d) => d.matches.resetMatch(MATCH, {} as never, d.req)],
  ['a bout voided', (d) => d.matches.voidMatch(MATCH, d.req)],
  [
    'a forfeit recorded',
    (d) => d.matches.createForfeit(MATCH, { reason: 'injury' } as never, d.req),
  ],
  ['a forfeit voided', (d) => d.matches.voidForfeit('forfeit-1', d.req)],
  ['a bout unlocked', (d) => d.matches.unlockMatch(MATCH, d.req)],
  ['the clock adjusted', (d) => d.matches.adjustClock(MATCH, {} as never, d.req)],
  ['a level bout resolved', (d) => d.matches.advanceLevelResolution(MATCH, d.req)],
  ['the sides swapped', (d) => d.matches.swapFighterSide(MATCH, d.req)],
];
/** The doors of an organiser alone: a pad is refused there for having no account. */
const ORGANISER_DOORS = ['a bout voided', 'a forfeit voided'];

const onEach = (list: Door[]) =>
  OVER.flatMap((status) => list.map(([name, send]) => [name, status, send] as const));

describe('every other result write on an over Event (ruling 250)', () => {
  it.each(onEach(CLOSED_DOORS))('%s: no account reaches it (%s)', async (_name, status, send) => {
    for (const caller of ['super admin', 'member'] as Caller[]) {
      const d = doors(status, caller);
      await expect(send(d)).rejects.toThrow(CLOSED);
      expect(d.calls).toEqual([]);
    }
  });

  it.each(onEach(CLOSED_DOORS))('%s: no pad reaches it (%s)', async (name, status, send) => {
    const d = doors(status, 'pad');
    const refusal = ORGANISER_DOORS.includes(name) ? /Organizer session required/ : CLOSED;
    await expect(send(d)).rejects.toThrow(refusal);
    expect(d.calls).toEqual([]);
  });

  it.each(CLOSED_DOORS)('%s: a member reaches it on a running Event', async (_name, send) => {
    await expect(send(doors('running', 'member'))).resolves.toBe('reached');
  });
});

describe('the bracket slot override (ruling 252)', () => {
  it('a member with the admin role reaches it on a completed Event', async () => {
    const d = doors('completed', 'member');
    await expect(
      d.slots.overrideSlot(SLOT, { registrationAId: null } as never, d.req),
    ).resolves.toEqual({ slotId: SLOT });
    expect(d.calls).toEqual(['overrideSlot']);
  });
});
