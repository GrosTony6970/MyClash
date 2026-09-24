import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { LiveStateController } from './live-state.controller';
import { LiveStateService } from './live-state.service';
import type { PublicReader } from '../../common/auth/competition-visibility';
import { ANONYMOUS_USER_ID } from '../../common/auth/request-user';
import { mockSupabase, queriedTables, selectsFor } from '../../common/testing/supabase-chain';
import { OrganizationsService } from '../organizations/organizations.service';

/**
 * The mock dispatches on TABLE NAME rather than on call order. live-state
 * issues `events` + `lices` inside one Promise.all and then
 * `event_programme_blocks` and `matches`, so an ordered
 * `mockReturnValueOnce` sequence desyncs the moment the service reorders
 * two awaits that have nothing to do with the assertion.
 */
const tables: Record<string, unknown> = {};

function makeChain(result: unknown) {
  const chain = Object.assign(Promise.resolve(result), {}) as Record<string, unknown> &
    Promise<unknown>;
  for (const key of ['select', 'eq', 'in', 'order', 'maybeSingle', 'limit', 'not']) {
    chain[key] = vi.fn().mockReturnValue(chain);
  }
  // maybeSingle terminates a chain, so it must resolve rather than chain.
  chain['maybeSingle'] = vi.fn().mockReturnValue(Promise.resolve(result));
  return chain;
}

const fromMock = vi.fn((table: string) => makeChain(tables[table] ?? { data: [], error: null }));
const supabase = { service: { from: fromMock } };
/** Refuses everyone, like `assertOrgRole` refuses a non-member. */
const orgs = { assertOrgRole: vi.fn(() => Promise.reject(new ForbiddenException('no'))) };
/** The same caller as the AuthGuard resolves it: no login, no staff session. */
const NO_ONE = { userId: ANONYMOUS_USER_ID, staff: null };

const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const UNKNOWN_ID = '33333333-3333-4333-8333-333333333333';
const LICE_ID = '22222222-2222-4222-8222-222222222222';

function match(over: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'm-1',
    status: 'scheduled',
    scheduled_at: null,
    match_number_label: 'M-1',
    lice_id: LICE_ID,
    red_score: 0,
    blue_score: 0,
    red: null,
    blue: null,
    phases: null,
    ...over,
  };
}

function service() {
  return new LiveStateService(supabase as never, orgs as never);
}

beforeEach(() => {
  fromMock.mockClear();
  for (const key of Object.keys(tables)) delete tables[key];
  tables['events'] = {
    // `status` + `organization_id` ride along on the read the service already
    // does; the gate consumes them without a second round-trip.
    data: {
      start_date: new Date().toISOString(),
      status: 'published',
      organization_id: 'org-1',
    },
    error: null,
  };
  tables['lices'] = { data: [{ id: LICE_ID, name: 'Piste 1', sort_order: 0 }], error: null };
  tables['event_programme_blocks'] = { data: [], error: null };
});

describe('LiveStateService — a paused bout still holds its piste', () => {
  it('reports a paused match as the running match, never as the next one', async () => {
    tables['matches'] = {
      data: [match({ id: 'm-paused', status: 'paused', match_number_label: 'M-42' })],
      error: null,
    };

    const state = await service().getLiveState(EVENT_ID, NO_ONE);

    // The regression: `status in ('running','scheduled')` dropped paused
    // bouts from the payload entirely, so a referee calling a halt made
    // the piste blink off the spectator boards mid-fight.
    expect(state.lices[0]?.runningMatch?.id).toBe('m-paused');
    expect(state.lices[0]?.runningMatch?.status).toBe('paused');
    expect(state.lices[0]?.nextMatch).toBeNull();
  });

  it('prefers a genuinely running bout when a piste carries both', async () => {
    tables['matches'] = {
      data: [
        match({ id: 'm-stale', status: 'paused' }),
        match({ id: 'm-live', status: 'running' }),
      ],
      error: null,
    };

    const state = await service().getLiveState(EVENT_ID, NO_ONE);

    expect(state.lices[0]?.runningMatch?.id).toBe('m-live');
  });

  it('leaves a merely scheduled bout out of the running slot', async () => {
    tables['matches'] = { data: [match({ id: 'm-later', status: 'scheduled' })], error: null };

    const state = await service().getLiveState(EVENT_ID, NO_ONE);

    expect(state.lices[0]?.runningMatch).toBeNull();
    expect(state.lices[0]?.nextMatch?.id).toBe('m-later');
  });
});

/**
 * This endpoint feeds the venue's hall display and the spectator app. Every
 * read used to drop `error`, so a refused query became an empty result and the
 * board confidently rendered every piste as idle — with a 200. An outage it
 * reports beats an outage it hides.
 */
describe('LiveStateService — a refused read is not an empty one', () => {
  it('does not report every piste idle when the matches read fails', async () => {
    tables['matches'] = { data: null, error: { message: 'connection reset' } };

    await expect(service().getLiveState(EVENT_ID, NO_ONE)).rejects.toThrow(/matches read failed/);
  });

  it('fails loudly when the lices read fails, rather than answering with no pistes', async () => {
    tables['lices'] = { data: null, error: { message: 'permission denied' } };

    await expect(service().getLiveState(EVENT_ID, NO_ONE)).rejects.toThrow(/lices read failed/);
  });

  it('fails loudly when the event read fails, rather than resolving the wrong day', async () => {
    tables['events'] = { data: null, error: { message: 'timeout' } };

    await expect(service().getLiveState(EVENT_ID, NO_ONE)).rejects.toThrow(/event read failed/);
  });

  it('fails loudly when the programme-block read fails', async () => {
    tables['event_programme_blocks'] = { data: null, error: { message: 'timeout' } };

    await expect(service().getLiveState(EVENT_ID, NO_ONE)).rejects.toThrow(
      /programme blocks read failed/,
    );
  });

  // `maybeSingle` raises PGRST116 when a slug matches more than one row, which
  // `events` allows: the UNIQUE is per organisation, not global. Swallowing the
  // error turned that into "Event not found" for an event that exists.
  it('distinguishes a failed slug lookup from a missing event', async () => {
    tables['events'] = { data: null, error: { message: 'PGRST116: multiple rows returned' } };

    await expect(service().getLiveState('open-2026', NO_ONE)).rejects.toThrow(
      /event slug read failed/,
    );
  });

  it('still reports a genuinely missing event as not found', async () => {
    tables['events'] = { data: null, error: null };

    await expect(service().getLiveState('no-such-event', NO_ONE)).rejects.toThrow(
      /Event not found/,
    );
  });

  /**
   * The board names every fighter currently on a piste, and this route is
   * @Public() and polled from the venue. Public was unconditional: an event
   * still being built published its live board to anyone with the id.
   */
  describe('unannounced events', () => {
    function withStatus(status: string) {
      tables['events'] = {
        data: {
          id: EVENT_ID,
          start_date: new Date().toISOString(),
          status,
          organization_id: 'org-1',
        },
        error: null,
      };
    }

    it("answers a stranger's read of a draft event exactly as an unknown id", async () => {
      withStatus('draft');
      const hidden = await service().getLiveState(EVENT_ID, NO_ONE);
      tables['events'] = { data: null, error: null };
      const unknown = await service().getLiveState(UNKNOWN_ID, NO_ONE);

      expect(hidden).toEqual(unknown);
      expect(hidden.lices).toEqual([]);
    });

    it("answers a stranger's read of a draft event by slug exactly as an unknown slug", async () => {
      withStatus('draft');
      const hidden = service().getLiveState('open-2026', NO_ONE);
      await expect(hidden).rejects.toBeInstanceOf(NotFoundException);
      await expect(hidden).rejects.toThrow(/^Event not found: open-2026$/);

      tables['events'] = { data: null, error: null };
      await expect(service().getLiveState('open-2026', NO_ONE)).rejects.toThrow(
        /^Event not found: open-2026$/,
      );
    });

    /** Archived stays readable on purpose — archiving locks writes, not reads. */
    it.each(['archived', 'completed'])('serves a %s event with its pistes', async (status) => {
      withStatus(status);
      const state = await service().getLiveState(EVENT_ID, NO_ONE);
      // A hidden Event also resolves (to the unknown board), so the pistes are
      // what tells served from hidden.
      expect(state.lices.map((l) => l.lice.id)).toEqual([LICE_ID]);
    });

    it('costs no extra query — the gate reads the row the board already fetched', async () => {
      withStatus('published');
      await service().getLiveState(EVENT_ID, NO_ONE);

      expect(fromMock.mock.calls.filter(([t]) => t === 'events')).toHaveLength(1);
    });
  });
});

/**
 * A published Event can run a Tournament its organisers have not published
 * yet. Its bouts stay off the public board — the hall hub, the event home —
 * and show to the club's members and the Event's own staff (ruling 90).
 */
describe('LiveStateService — a bout of an unpublished Tournament', () => {
  const bout = (id: string, status: string, tournamentStatus: string) => ({
    ...match({ id, status }),
    phases: { tournaments: { id: `t-${id}`, name: `T ${id}`, status: tournamentStatus } },
    // The flat key a dotted filter reads on a seeded row (`onlyPublicTournaments`).
    'phases.tournaments.status': tournamentStatus,
  });

  function board(eventStatus = 'published') {
    const db = mockSupabase({
      events: {
        rows: [
          {
            id: EVENT_ID,
            start_date: new Date().toISOString(),
            timezone: null,
            status: eventStatus,
            organization_id: 'org-1',
          },
        ],
      },
      lices: { rows: [{ id: LICE_ID, event_id: EVENT_ID, name: 'Piste 1', sort_order: 0 }] },
      event_programme_blocks: { rows: [] },
      matches: {
        rows: [bout('m-draft-t', 'running', 'draft'), bout('m-public', 'scheduled', 'published')],
      },
      organization_members: {
        rows: [{ organization_id: 'org-1', user_id: 'u-member', role: 'read_only' }],
      },
      event_staff_accounts: {
        rows: [
          { id: 'staff-here', event_id: EVENT_ID, status: 'active' },
          { id: 'staff-there', event_id: 'event-2', status: 'active' },
        ],
      },
    });
    const live = new LiveStateService(db as never, new OrganizationsService(db as never));
    const read = (reader: PublicReader) => live.getLiveState(EVENT_ID, reader);
    return { read, db };
  }
  const reader = (userId: string, staff: PublicReader['staff'] = null) => ({ userId, staff });

  it('is left off the board for a projector with no login, and for a stranger', async () => {
    for (const caller of [
      reader(ANONYMOUS_USER_ID),
      reader('u-stranger'),
      reader(ANONYMOUS_USER_ID, { staffId: 'staff-there', eventId: 'event-2' }),
    ]) {
      const [piste] = (await board().read(caller)).lices;
      expect(piste?.runningMatch, JSON.stringify(caller)).toBeNull();
      expect(piste?.nextMatch?.id).toBe('m-public');
    }
  });

  it("shows to a club member and to the Event's own staff", async () => {
    for (const caller of [
      reader('u-member'),
      reader(ANONYMOUS_USER_ID, { staffId: 'staff-here', eventId: EVENT_ID }),
    ]) {
      const [piste] = (await board().read(caller)).lices;
      expect(piste?.runningMatch?.id, JSON.stringify(caller)).toBe('m-draft-t');
    }
  });

  it('shows a draft event to its club and its own staff, from the caller the guard verified', async () => {
    // [caller, membership reads, staff reads]: one answer serves both the Event
    // gate and the bouts filter, so each caller is asked about exactly once.
    for (const [caller, members, staff] of [
      [reader('u-member'), 1, 0],
      [reader(ANONYMOUS_USER_ID, { staffId: 'staff-here', eventId: EVENT_ID }), 0, 1],
    ] as const) {
      const { read, db } = board('draft');
      const [piste] = (await read(caller)).lices;
      expect(piste?.runningMatch?.id, JSON.stringify(caller)).toBe('m-draft-t');
      const reads = (table: string) => queriedTables(db.from).filter((t) => t === table).length;
      expect(reads('organization_members'), JSON.stringify(caller)).toBe(members);
      expect(reads('event_staff_accounts'), JSON.stringify(caller)).toBe(staff);
    }
  });

  it('hides a draft event from a projector with no login, at no read', async () => {
    const { read, db } = board('draft');
    expect((await read(reader(ANONYMOUS_USER_ID))).lices).toEqual([]);
    expect(queriedTables(db.from)).not.toContain('organization_members');
    expect(queriedTables(db.from)).not.toContain('event_staff_accounts');
  });

  it("hides a draft event from a stranger and from another Event's staff", async () => {
    for (const caller of [
      reader('u-stranger'),
      reader(ANONYMOUS_USER_ID, { staffId: 'staff-there', eventId: 'event-2' }),
    ]) {
      expect((await board('draft').read(caller)).lices, JSON.stringify(caller)).toEqual([]);
    }
  });

  it('reads the Tournament status through inner embeds, and nothing more for a projector', async () => {
    const { read, db } = board();
    await read(reader(ANONYMOUS_USER_ID));

    // The double hands back the whole row whatever is selected, and PostgREST
    // filters bouts through an embed only when every embed on the path is inner.
    const [select] = selectsFor(db.from, 'matches');
    expect(select).toContain('phases!inner(');
    expect(select).toMatch(/tournaments!inner\([^)]*\bstatus\b/);
    // Polled all day from the hall: no login, no membership read.
    expect(queriedTables(db.from)).not.toContain('organization_members');
    expect(queriedTables(db.from)).not.toContain('event_staff_accounts');
  });
});

describe('LiveStateController', () => {
  it('hands the service the caller the AuthGuard resolved', async () => {
    const live = { getLiveState: vi.fn(() => Promise.resolve({})) };
    const controller = new LiveStateController(live as never);
    const staff = { staffId: 'staff-here', eventId: EVENT_ID };
    const req = {
      headers: {},
      cookies: {},
      identity: { kind: 'claimed', userId: 'u-member', email: null },
      staffSession: staff,
    };

    await controller.getLiveState(EVENT_ID, req as never);

    expect(live.getLiveState).toHaveBeenCalledWith(EVENT_ID, {
      userId: 'u-member',
      staff,
    });
  });
});
