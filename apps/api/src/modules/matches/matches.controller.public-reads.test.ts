/**
 * Who may read a bout through the public routes the pad and the projector use:
 * the bout, its summary, its exchanges, its clock, its cards and its display
 * payload (operator rulings 81-83, 89). The last two live on the penalties and
 * staff controllers; they are here because the projector reads all six at once
 * (`useLiveMatch`), and a screen gated on some of them shows a wrong scoreboard.
 *
 * Until 2026-09-23 all six answered anyone for any bout, a draft Event's
 * included. Now a bout of a DRAFT Event, or of a Tournament that is not
 * published, running or completed, is hidden from everyone but a member of the
 * Event's club and an ACTIVE staff session of the same Event. A hidden bout
 * answers exactly as an unknown one does, so the difference reveals nothing.
 *
 * The membership and staff checks run for real over seeded tables; the bout
 * reads are stubbed with the answers the real service gives an unknown id.
 */
import 'reflect-metadata';
import { NotFoundException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSupabase, queriedTables, selectsFor } from '../../common/testing/supabase-chain';
import { OrganizationsService } from '../organizations/organizations.service';
import { PenaltiesController } from '../penalties/penalties.controller';
import { StaffController } from '../staff/staff.controller';
import { ClockService } from './clock.service';
import { MatchesController } from './matches.controller';

const EVENT_OPEN = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const EVENT_DRAFT = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const OPEN = '11111111-1111-4111-8111-111111111111';
const IN_DRAFT_EVENT = '22222222-2222-4222-8222-222222222222';
const IN_DRAFT_TOURNAMENT = '33333333-3333-4333-8333-333333333333';
const UNKNOWN = '99999999-9999-4999-8999-999999999999';
const PUBLISHED_T = '44444444-4444-4444-8444-444444444444';
const COMPLETED_T = '55555555-5555-4555-8555-555555555555';
/** One visible bout per public Tournament status. */
const VISIBLE = [OPEN, PUBLISHED_T, COMPLETED_T];

function bout(id: string, tournamentStatus: string, eventId: string, eventStatus: string) {
  return {
    id,
    phases: {
      tournaments: {
        status: tournamentStatus,
        events: { id: eventId, status: eventStatus, organization_id: 'org-a' },
      },
    },
  };
}

let db: ReturnType<typeof mockSupabase>;
let controller: MatchesController;
let penalties: PenaltiesController;
let staff: StaffController;
/** Every stubbed bout read, across the three controllers. */
let matches: Record<string, ReturnType<typeof vi.fn>>;
const KNOWN = new Set([...VISIBLE, IN_DRAFT_EVENT, IN_DRAFT_TOURNAMENT]);

// A running clock counts up from `now`; two reads must see the same instant to compare.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-23T10:05:00Z'));
});
afterEach(() => vi.useRealTimers());

beforeEach(() => {
  db = mockSupabase({
    matches: {
      rows: [
        bout(OPEN, 'running', EVENT_OPEN, 'published'),
        bout(PUBLISHED_T, 'published', EVENT_OPEN, 'published'),
        bout(COMPLETED_T, 'completed', EVENT_OPEN, 'published'),
        bout(IN_DRAFT_EVENT, 'running', EVENT_DRAFT, 'draft'),
        bout(IN_DRAFT_TOURNAMENT, 'draft', EVENT_OPEN, 'published'),
      ],
    },
    match_events: {
      rows: [...KNOWN].map((id, i) => ({
        id: `ev-${i}`,
        match_id: id,
        type: 'start',
        reason: null,
        occurred_at: '2026-09-23T10:00:00Z',
        sequence: 1,
      })),
    },
    organization_members: {
      rows: [
        { organization_id: 'org-a', user_id: 'u-member', role: 'read_only' },
        { organization_id: 'org-b', user_id: 'u-owner-b', role: 'owner' },
      ],
    },
    event_staff_accounts: {
      rows: [
        { id: 'staff-draft', event_id: EVENT_DRAFT, status: 'active' },
        { id: 'staff-off', event_id: EVENT_DRAFT, status: 'disabled' },
        { id: 'staff-open', event_id: EVENT_OPEN, status: 'active' },
      ],
    },
  });
  const supabase = { service: db.service };
  const notFound = (id: string) => new NotFoundException(`Match ${id} not found`);
  matches = {
    getMatch: vi.fn(async (id: string) => {
      if (!KNOWN.has(id)) throw notFound(id);
      return { id };
    }),
    getMatchSummary: vi.fn(async (id: string) => {
      if (!KNOWN.has(id)) throw notFound(id);
      return { matchId: id };
    }),
    listExchanges: vi.fn(async (id: string) => (KNOWN.has(id) ? [{ id: `x-${id}` }] : [])),
    // PenaltiesService: an unknown bout has no cards.
    listMatchPenalties: vi.fn(async (id: string) => (KNOWN.has(id) ? [{ id: `p-${id}` }] : [])),
    // StaffService: the display payload 404s an unknown bout in its own words.
    getPublicMatchDisplay: vi.fn(async (id: string) => {
      if (!KNOWN.has(id)) throw new NotFoundException('Match not found');
      return { display: id };
    }),
  };
  const orgs = new OrganizationsService(supabase as never);
  controller = new MatchesController(
    matches as never,
    {} as never,
    new ClockService(supabase as never),
    {} as never,
    {} as never,
    {} as never,
    supabase as never,
    orgs,
  );
  penalties = new PenaltiesController(matches as never, supabase as never, {} as never, orgs);
  staff = new StaffController(matches as never, supabase as never, orgs);
});

type Caller = { user?: string; staff?: { staffId: string; eventId: string } };

/**
 * A request as the AuthGuard leaves it. The login wins the identity, and a
 * staff cookie is kept beside it either way: a pad can carry both.
 */
function req(caller: Caller = {}) {
  const identity = caller.user
    ? { kind: 'claimed', userId: caller.user, email: null }
    : caller.staff
      ? { kind: 'staff', ...caller.staff }
      : { kind: 'anonymous' };
  return { headers: {}, cookies: {}, identity, staffSession: caller.staff ?? null } as never;
}

/** The answer, or the refusal's body, with the bout id blanked so two ids compare. */
async function answer(call: Promise<unknown>, id: string): Promise<string> {
  const result = await call.then(
    (value) => ({ value }),
    (error: unknown) => ({ refused: (error as NotFoundException).getResponse() }),
  );
  return JSON.stringify(result).replaceAll(id, '<id>');
}

const ROUTES = {
  getMatch: (id: string, r: never) => controller.getMatch(id, r),
  getMatchSummary: (id: string, r: never) => controller.getMatchSummary(id, r),
  listExchanges: (id: string, r: never) => controller.listExchanges(id, r),
  getClockState: (id: string, r: never) => controller.getClockState(id, r),
  listMatchPenalties: (id: string, r: never) => penalties.listMatchPenalties(id, r),
  publicMatchDisplay: (id: string, r: never) => staff.publicMatchDisplay(id, r),
};

const STRANGERS: Caller[] = [
  {},
  { user: 'u-stranger' },
  { user: 'u-owner-b' },
  { staff: { staffId: 'staff-open', eventId: EVENT_OPEN } },
  { staff: { staffId: 'staff-off', eventId: EVENT_DRAFT } },
  { user: 'u-stranger', staff: { staffId: 'staff-open', eventId: EVENT_OPEN } },
];

describe.each(Object.keys(ROUTES) as Array<keyof typeof ROUTES>)('%s (rulings 81-83)', (route) => {
  const call = (id: string, caller?: Caller) => ROUTES[route](id, req(caller));

  it("shows a published, running or completed Tournament's bout to anyone, signed out included", async () => {
    const unknown = await answer(call(UNKNOWN), UNKNOWN);
    for (const id of VISIBLE) {
      expect(await answer(call(id), id), id).toBe(await answer(call(id, { user: 'u-member' }), id));
      expect(await answer(call(id), id), id).not.toBe(unknown);
    }
  });

  it("answers a draft Event's bout to outsiders exactly as an unknown bout", async () => {
    const unknown = await answer(call(UNKNOWN), UNKNOWN);
    for (const caller of STRANGERS) {
      expect(
        await answer(call(IN_DRAFT_EVENT, caller), IN_DRAFT_EVENT),
        JSON.stringify(caller),
      ).toBe(unknown);
    }
  });

  it('answers a draft Tournament of a published Event to outsiders as an unknown bout', async () => {
    const unknown = await answer(call(UNKNOWN), UNKNOWN);
    expect(await answer(call(IN_DRAFT_TOURNAMENT), IN_DRAFT_TOURNAMENT)).toBe(unknown);
    expect(
      await answer(call(IN_DRAFT_TOURNAMENT, { user: 'u-owner-b' }), IN_DRAFT_TOURNAMENT),
    ).toBe(unknown);
  });

  it("shows a hidden bout to a member of the club and to the same Event's active staff", async () => {
    const unknown = await answer(call(UNKNOWN), UNKNOWN);
    const staff = { staff: { staffId: 'staff-draft', eventId: EVENT_DRAFT } };
    expect(await answer(call(IN_DRAFT_EVENT, staff), IN_DRAFT_EVENT)).not.toBe(unknown);
    expect(await answer(call(IN_DRAFT_EVENT, { user: 'u-member' }), IN_DRAFT_EVENT)).not.toBe(
      unknown,
    );
    expect(
      await answer(call(IN_DRAFT_TOURNAMENT, { user: 'u-member' }), IN_DRAFT_TOURNAMENT),
    ).not.toBe(unknown);
  });

  it("shows a hidden bout to the Event's pad even when a stranger once signed in on it", async () => {
    const unknown = await answer(call(UNKNOWN), UNKNOWN);
    const pad = { user: 'u-stranger', staff: { staffId: 'staff-draft', eventId: EVENT_DRAFT } };
    expect(await answer(call(IN_DRAFT_EVENT, pad), IN_DRAFT_EVENT)).not.toBe(unknown);
  });

  it('reads each deciding column', async () => {
    await call(IN_DRAFT_EVENT, { staff: { staffId: 'staff-draft', eventId: EVENT_DRAFT } });
    await call(IN_DRAFT_EVENT, { user: 'u-member' });
    // The double hands back the whole row whatever is selected.
    expect(selectsFor(db.from, 'matches')).toContain(
      'phases!inner(tournaments!inner(status, events!inner(id, status, organization_id)))',
    );
    expect(selectsFor(db.from, 'event_staff_accounts')).toEqual(['status']);
    expect(selectsFor(db.from, 'organization_members')).toEqual(['role']);
  });
});

describe('the display payload', () => {
  it('narrows its NEXT bout for the caller the gate decided on', async () => {
    const pad = { user: 'u-stranger', staff: { staffId: 'staff-draft', eventId: EVENT_DRAFT } };
    await staff.publicMatchDisplay(OPEN, req(pad));
    expect(matches['getPublicMatchDisplay']).toHaveBeenCalledWith(OPEN, {
      userId: 'u-stranger',
      staff: pad.staff,
    });
  });
});

describe('a hidden bout reads nothing past the gate', () => {
  it('reads no bout, summary, exchanges or clock events', async () => {
    for (const route of Object.values(ROUTES)) {
      await route(IN_DRAFT_EVENT, req()).catch(() => undefined);
    }
    for (const read of Object.values(matches)) expect(read).not.toHaveBeenCalled();
    expect(queriedTables(db.from)).not.toContain('match_events');
  });
});
