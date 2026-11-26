import { describe, expect, it, vi } from 'vitest';
import { expectNoRawIds } from './no-raw-ids.test-helper';
import { eventSchedule } from './event-schedule';

const caller = { userId: 'user-1', email: 'a@b.c', clientId: 'c' };
const id = (n: number) => `0000000${n}-aaaa-4bbb-8ccc-00000000000${n}`;

const eventRow = {
  id: id(1),
  name: 'FAL 2026',
  slug: 'fal-2026',
  start_date: '2026-03-14',
  end_date: '2026-03-15',
  status: 'published',
  // Winter: UTC+1.
  timezone: 'Europe/Paris',
  city: 'Lyon',
  country: 'FR',
  organization_id: id(3),
  event_kind: 'real',
};

const match = (over: Record<string, unknown> = {}) => ({
  id: id(2),
  matchNumberLabel: 'M01',
  roundCode: 'LSW-P1-M01',
  status: 'scheduled',
  liceId: id(4),
  scheduledAt: '2026-03-14T09:00:00Z',
  redFighterName: 'Anna Roux',
  blueFighterName: 'Bob Petit',
  redRegistrationId: id(5),
  blueRegistrationId: id(6),
  tournamentName: 'Longsword',
  tournamentSlug: 'longsword',
  poolId: id(7),
  poolName: 'Pool 1',
  ...over,
});

interface Call {
  table: string;
  select?: string;
  eq: [string, unknown][];
}

function depsFor(opts: {
  matches: unknown[];
  noEvent?: boolean;
  lices?: { data: unknown; error: { message: string } | null };
}) {
  const calls: Call[] = [];
  const from = (table: string) => {
    const call: Call = { table, eq: [] };
    calls.push(call);
    const result =
      table === 'lices'
        ? (opts.lices ?? { data: [{ id: id(4), name: 'Lice A' }], error: null })
        : { data: table === 'events' && !opts.noEvent ? eventRow : null, error: null };
    // `maybeSingle` ends the events read; awaiting the chain ends the lices read.
    const chain = {
      select: (s: string) => {
        call.select = s;
        return chain;
      },
      eq: (c: string, v: unknown) => {
        call.eq.push([c, v]);
        return chain;
      },
      maybeSingle: () => Promise.resolve(result),
      then: (ok: (r: unknown) => unknown, bad: (e: unknown) => unknown) =>
        Promise.resolve(result).then(ok, bad),
    };
    return chain;
  };
  const listEventSchedule = vi.fn().mockResolvedValue(opts.matches);
  return {
    calls,
    listEventSchedule,
    deps: {
      supabase: { service: { from } },
      orgs: {},
      scheduleGrid: { listEventSchedule },
    } as never,
  };
}

const run = (
  matches: unknown[],
  args: { tournament?: string; day?: string; limit?: number } = {},
) => {
  const d = depsFor({ matches });
  return { d, result: eventSchedule('fal-2026', args, caller, d.deps) };
};

describe('event_schedule', () => {
  it('maps the grid to names, with the lice named and no id at any depth', async () => {
    const { d, result } = run([match()]);
    const answer = await result;
    expect(d.listEventSchedule).toHaveBeenCalledWith(id(1), { userId: 'user-1', staff: null });
    expect(answer).toEqual({
      timezone: 'Europe/Paris',
      total: 1,
      fights: [
        {
          start: '2026-03-14T09:00:00Z',
          liceName: 'Lice A',
          tournamentName: 'Longsword',
          tournamentSlug: 'longsword',
          roundCode: 'LSW-P1-M01',
          red: 'Anna Roux',
          blue: 'Bob Petit',
          status: 'scheduled',
        },
      ],
    });
    expectNoRawIds(answer);
  });

  it('reads the lices of this Event once, asserting select and filter', async () => {
    const { d, result } = run([match(), match({ roundCode: 'LSW-P1-M02' })]);
    await result;
    const lices = d.calls.filter((c) => c.table === 'lices');
    expect(lices).toHaveLength(1);
    expect(lices[0]?.select).toBe('id, name');
    expect(lices[0]?.eq).toEqual([['event_id', id(1)]]);
  });

  it('throws when the lices read fails: a lice name is not optional to guess', async () => {
    const d = depsFor({ matches: [match()], lices: { data: null, error: { message: 'boom' } } });
    await expect(eventSchedule('fal-2026', {}, caller, d.deps)).rejects.toThrow(
      'lices read failed: boom',
    );
  });

  it('sorts by start and lists unscheduled bouts last', async () => {
    const { result } = run([
      match({ roundCode: 'C', scheduledAt: null }),
      match({ roundCode: 'B', scheduledAt: '2026-03-14T10:00:00Z' }),
      match({ roundCode: 'A', scheduledAt: '2026-03-14T09:00:00Z' }),
    ]);
    const answer = (await result) as { fights: { roundCode: string }[] };
    expect(answer.fights.map((f) => f.roundCode)).toEqual(['A', 'B', 'C']);
  });

  it('filters by Tournament slug', async () => {
    const matches = [match({ roundCode: 'A' }), match({ roundCode: 'B', tournamentSlug: 'sabre' })];
    const answer = (await eventSchedule(
      'fal-2026',
      { tournament: 'sabre' },
      caller,
      depsFor({ matches }).deps,
    )) as { total: number; fights: { roundCode: string }[] };
    expect(answer.fights.map((f) => f.roundCode)).toEqual(['B']);
    expect(answer.total).toBe(1);
  });

  it("filters by the day in the Event's own time zone: 23:30Z is the next day in Paris", async () => {
    const matches = [
      match({ roundCode: 'LATE', scheduledAt: '2026-03-14T23:30:00Z' }),
      match({ roundCode: 'EARLY', scheduledAt: '2026-03-14T09:00:00Z' }),
      match({ roundCode: 'UNSCHEDULED', scheduledAt: null }),
    ];
    const codes = async (day: string) =>
      (
        (await eventSchedule('fal-2026', { day }, caller, depsFor({ matches }).deps)) as {
          fights: { roundCode: string }[];
        }
      ).fights.map((f) => f.roundCode);
    // The 23:30Z bout starts at 00:30 on the 15th in Paris; an unscheduled bout has no day.
    expect(await codes('2026-03-15')).toEqual(['LATE']);
    expect(await codes('2026-03-14')).toEqual(['EARLY']);
  });

  it('caps at the limit and says how many matched before the cap', async () => {
    const matches = Array.from({ length: 5 }, (_, i) =>
      match({ roundCode: `M${i}`, scheduledAt: `2026-03-14T0${i}:00:00Z` }),
    );
    const answer = (await eventSchedule(
      'fal-2026',
      { limit: 2 },
      caller,
      depsFor({ matches }).deps,
    )) as {
      total: number;
      fights: unknown[];
    };
    expect(answer.total).toBe(5);
    expect(answer.fights).toHaveLength(2);
  });

  it('defaults the cap to 20', async () => {
    const matches = Array.from({ length: 25 }, (_, i) => match({ roundCode: `M${i}` }));
    const answer = (await eventSchedule('fal-2026', {}, caller, depsFor({ matches }).deps)) as {
      total: number;
      fights: unknown[];
    };
    expect(answer.total).toBe(25);
    expect(answer.fights).toHaveLength(20);
  });

  it('refuses a Tournament slug no bout carries, rather than answering an empty list', async () => {
    const answer = await eventSchedule(
      'fal-2026',
      { tournament: 'nope-t' },
      caller,
      depsFor({ matches: [match()] }).deps,
    );
    expect(answer).toEqual({ refusal: 'No Tournament "nope-t" at FAL 2026 that you can see.' });
  });

  it('refuses an Event the caller cannot read as unknown', async () => {
    const d = depsFor({ matches: [], noEvent: true });
    expect(await eventSchedule('nope', {}, caller, d.deps)).toEqual({
      refusal: 'No Event "nope" that you can see.',
    });
    expect(d.listEventSchedule).not.toHaveBeenCalled();
  });
});
