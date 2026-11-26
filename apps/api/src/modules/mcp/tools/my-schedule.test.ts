import { describe, expect, it, vi } from 'vitest';
import type { PersonSchedule } from '../../persons/public-schedule.service';
import { expectNoRawIds } from './no-raw-ids.test-helper';
import { mySchedule } from './my-schedule';

const caller = { userId: 'user-1', email: 'a@b.c', clientId: 'c' };
const EVENT_ID = '00000001-aaaa-4bbb-8ccc-000000000001';
const PERSON_ID = '00000009-aaaa-4bbb-8ccc-000000000009';

const eventRow = {
  id: EVENT_ID,
  name: 'FAL 2026',
  slug: 'fal-2026',
  start_date: '2026-03-14',
  end_date: '2026-03-15',
  status: 'published',
  timezone: 'Europe/Paris',
  organization_id: '00000003-aaaa-4bbb-8ccc-000000000003',
  event_kind: 'real',
};

/** A chain double that records every select string and filter, per table. */
function supabaseDouble(opts: { event?: unknown; person?: { data: unknown; error: unknown } }) {
  const calls: { table: string; select?: string; eq: [string, unknown][] }[] = [];
  const from = (table: string) => {
    const call: (typeof calls)[number] = { table, eq: [] };
    calls.push(call);
    const chain = {
      select: (s: string) => {
        call.select = s;
        return chain;
      },
      eq: (c: string, v: unknown) => {
        call.eq.push([c, v]);
        return chain;
      },
      maybeSingle: () =>
        Promise.resolve(
          table === 'events'
            ? { data: opts.event ?? null, error: null }
            : (opts.person ?? { data: null, error: null }),
        ),
    };
    return chain;
  };
  return { calls, supabase: { service: { from } } };
}

const schedule = {
  personId: PERSON_ID,
  timezone: 'Europe/Paris',
  matches: [
    {
      id: '00000002-aaaa-4bbb-8ccc-000000000002',
      roundCode: 'LSW-P4-M01',
      status: 'completed',
      scheduledAt: '2026-03-14T09:00:00Z',
      durationMinutes: 5,
      fallbackEndsAt: null,
      opponentName: 'Jeanne Martin',
      opponentClub: 'Club',
      redScore: 7,
      blueScore: 3,
      outcome: 'win',
      isRed: true,
      sideColors: { red: 'a', blue: 'b' },
      poolId: '00000004-aaaa-4bbb-8ccc-000000000004',
      poolName: 'Pool 4',
      tournamentName: 'Longsword',
      tournamentId: '00000005-aaaa-4bbb-8ccc-000000000005',
      phase: 'pool',
      phaseId: '00000006-aaaa-4bbb-8ccc-000000000006',
      liceName: 'Lice A',
    },
    {
      id: '00000002-aaaa-4bbb-8ccc-000000000012',
      roundCode: 'LSW-P4-M02',
      status: 'scheduled',
      scheduledAt: '2026-03-14T10:00:00Z',
      opponentName: null,
      redScore: 2,
      blueScore: 5,
      isRed: false,
      tournamentName: 'Longsword',
      liceName: null,
    },
  ],
  poolSpans: [],
  phaseSpans: [],
  refereeSlots: [
    {
      id: '00000007-aaaa-4bbb-8ccc-000000000007',
      matchId: '00000002-aaaa-4bbb-8ccc-000000000002',
      roundCode: 'LSW-P4-M01',
      scheduledAt: '2026-03-14T11:00:00Z',
      startsAt: '2026-03-14T11:00:00Z',
      endsAt: '2026-03-14T12:00:00Z',
      role: 'Judge',
      poolName: 'Pool 4',
      poolId: '00000004-aaaa-4bbb-8ccc-000000000004',
      tournamentName: 'Longsword',
      tournamentSlug: 'longsword',
      liceName: 'Lice B',
    },
  ],
  workshops: [
    {
      workshopId: '00000008-aaaa-4bbb-8ccc-000000000008',
      workshopSlug: 'footwork',
      workshopName: 'Footwork',
      sessionStart: '2026-03-14T13:00:00Z',
      sessionEnd: '2026-03-14T14:00:00Z',
      location: 'Hall 2',
      status: 'confirmed',
      sessionCancelled: false,
    },
  ],
  refusedWorkshopIds: ['00000008-aaaa-4bbb-8ccc-000000000008'],
} as unknown as PersonSchedule;

function depsFor(double: ReturnType<typeof supabaseDouble>, getSchedule = vi.fn()) {
  return { supabase: double.supabase, orgs: {}, schedule: { getSchedule } } as never;
}

describe('my_schedule', () => {
  it('maps the schedule to names and times, with no id at any depth', async () => {
    const double = supabaseDouble({
      event: eventRow,
      person: { data: { id: PERSON_ID }, error: null },
    });
    const getSchedule = vi.fn().mockResolvedValue(schedule);
    const result = await mySchedule('fal-2026', caller, depsFor(double, getSchedule));

    // Own view: the requester is the person.
    expect(getSchedule).toHaveBeenCalledWith(EVENT_ID, PERSON_ID, PERSON_ID);
    expect(result).toEqual({
      event: { name: 'FAL 2026', slug: 'fal-2026' },
      fights: [
        {
          tournamentName: 'Longsword',
          roundCode: 'LSW-P4-M01',
          opponentName: 'Jeanne Martin',
          liceName: 'Lice A',
          start: '2026-03-14T09:00:00Z',
          status: 'completed',
          score: { mine: 7, opponent: 3 },
        },
        {
          tournamentName: 'Longsword',
          roundCode: 'LSW-P4-M02',
          opponentName: null,
          liceName: null,
          start: '2026-03-14T10:00:00Z',
          status: 'scheduled',
          score: { mine: 5, opponent: 2 },
        },
      ],
      refereeing: [
        {
          tournamentName: 'Longsword',
          poolName: 'Pool 4',
          role: 'Judge',
          liceName: 'Lice B',
          start: '2026-03-14T11:00:00Z',
          end: '2026-03-14T12:00:00Z',
        },
      ],
      workshops: [
        {
          name: 'Footwork',
          start: '2026-03-14T13:00:00Z',
          end: '2026-03-14T14:00:00Z',
          location: 'Hall 2',
          cancelled: false,
        },
      ],
    });
    expectNoRawIds(result);
  });

  it('answers no workshops when the schedule hides them', async () => {
    const double = supabaseDouble({
      event: eventRow,
      person: { data: { id: PERSON_ID }, error: null },
    });
    const getSchedule = vi.fn().mockResolvedValue({ ...schedule, workshops: null });
    const result = await mySchedule('fal-2026', caller, depsFor(double, getSchedule));
    expect(result).toMatchObject({ workshops: [] });
  });

  it("finds the person by the caller's login at this Event, asserting select and filters", async () => {
    const double = supabaseDouble({
      event: eventRow,
      person: { data: { id: PERSON_ID }, error: null },
    });
    await mySchedule('fal-2026', caller, depsFor(double, vi.fn().mockResolvedValue(schedule)));
    const persons = double.calls.find((c) => c.table === 'persons');
    expect(persons?.select).toBe('id');
    expect(persons?.eq).toEqual([
      ['claimed_by_user_id', 'user-1'],
      ['event_id', EVENT_ID],
    ]);
  });

  it("says when you are not on this Event's roster", async () => {
    const double = supabaseDouble({ event: eventRow });
    const getSchedule = vi.fn();
    const result = await mySchedule('fal-2026', caller, depsFor(double, getSchedule));
    expect(result).toEqual({ refusal: 'You are not on the roster of FAL 2026.' });
    expect(getSchedule).not.toHaveBeenCalled();
  });

  it('refuses an Event the caller cannot read as unknown', async () => {
    const double = supabaseDouble({});
    const getSchedule = vi.fn();
    const result = await mySchedule('nope', caller, depsFor(double, getSchedule));
    expect(result).toEqual({ refusal: 'No Event "nope" that you can see.' });
    expect(getSchedule).not.toHaveBeenCalled();
  });

  it('refuses with a retry sentence, not "not on the roster", when the person read fails', async () => {
    const double = supabaseDouble({
      event: eventRow,
      person: { data: null, error: { message: 'connection reset' } },
    });
    const result = await mySchedule('fal-2026', caller, depsFor(double));
    expect(result).toEqual({ refusal: 'Could not read your schedule. Try again.' });
  });
});
