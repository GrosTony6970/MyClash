import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveDutyWindows, resolvePhaseSpans, resolvePoolSpans } from '../schedule/duty-windows';
import { resolveMatchLengths } from '../schedule/match-lengths';
import { resolveNextBoutEnds } from '../schedule/next-bout-end';
import { resolvePoolBlocks } from '../schedule/pool-block-ends';
import {
  buildService,
  fighterMatch,
  matchScoped,
  PHASE,
  poolScoped,
  projection,
  rows,
} from './public-schedule.fixtures';

// The helpers are plain modules with reads of their own, proven by their own
// tests. Mocked here so this file holds what the service hands them and what it
// does with the answer.
vi.mock('../schedule/duty-windows', () => ({
  resolveDutyWindows: vi.fn(),
  resolvePoolSpans: vi.fn(),
  resolvePhaseSpans: vi.fn(),
}));
vi.mock('../schedule/match-lengths', () => ({ resolveMatchLengths: vi.fn() }));
vi.mock('../schedule/next-bout-end', () => ({ resolveNextBoutEnds: vi.fn() }));
// The read is mocked; `endWithBlock`, the pure stretch, stays real.
vi.mock('../schedule/pool-block-ends', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  resolvePoolBlocks: vi.fn(),
}));

const poolBlocks = vi.mocked(resolvePoolBlocks);
const dutyWindows = vi.mocked(resolveDutyWindows);
const poolSpans = vi.mocked(resolvePoolSpans);
const phaseSpans = vi.mocked(resolvePhaseSpans);
const matchLengths = vi.mocked(resolveMatchLengths);
const nextBoutEnds = vi.mocked(resolveNextBoutEnds);

/** Unless a case says otherwise, every Pool comes back untimed, and no bout has a next bout. */
beforeEach(() => {
  poolSpans.mockImplementation(async (_db, _logger, _eventId, pools) =>
    pools.map((pool) => ({ ...pool, startsAt: null, endsAt: null })),
  );
  phaseSpans.mockImplementation(async (_db, _logger, _eventId, phases) =>
    phases.map((phase) => ({ ...phase, startsAt: null, endsAt: null })),
  );
  nextBoutEnds.mockImplementation(
    async (_db, _logger, _eventId, bouts) => new Map(bouts.map((bout) => [bout.id, null])),
  );
  poolBlocks.mockResolvedValue(new Map());
});

/**
 * Referee slots mix two shapes: match-scoped rows (display time = the match's
 * `scheduled_at`) and pool-scoped rows (display time = the duty's start, worked
 * out from its Pool's Matches). No single column orders that mix, so the service
 * sorts on `scheduledAt ?? startsAt` — the same key the schedule view uses.
 * The seeded rows are in `public-schedule.fixtures.ts`.
 */

/** The helper's answer: a window for every duty, untimed unless listed. */
function windowsAre(times: Record<string, [string | null, string | null]>) {
  dutyWindows.mockImplementation(
    async (_db, _logger, duties) =>
      new Map(
        duties.map((duty) => {
          const [startsAt, endsAt] = times[duty.id] ?? [null, null];
          return [duty.id, { startsAt, endsAt }];
        }),
      ),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  dutyWindows.mockReset();
  poolSpans.mockReset();
  phaseSpans.mockReset();
  matchLengths.mockReset();
  nextBoutEnds.mockReset();
  poolBlocks.mockReset();
});

describe('PublicScheduleService.getSchedule — referee slot times', () => {
  it('orders match-scoped and pool-scoped duties together on their display time', async () => {
    windowsAre({ 'pool-sat': ['2027-05-22T13:00:00.000Z', '2027-05-22T14:00:00.000Z'] });
    const { service } = buildService(
      rows([
        matchScoped('qf-late', '2027-05-23T13:21:00Z'),
        poolScoped('pool-sat'),
        matchScoped('qf-early', '2027-05-23T09:11:00Z'),
      ]),
    );
    const schedule = await service.getSchedule('e-1', 'p-1', null);
    expect(schedule.refereeSlots.map((s) => s.id)).toEqual(['pool-sat', 'qf-early', 'qf-late']);
  });

  it('puts undated duties last', async () => {
    windowsAre({});
    const { service } = buildService(
      rows([poolScoped('tbd'), matchScoped('dated', '2027-05-23T09:00:00Z')]),
    );
    const schedule = await service.getSchedule('e-1', 'p-1', null);
    expect(schedule.refereeSlots.map((s) => s.id)).toEqual(['dated', 'tbd']);
  });

  it("names a bout's duty by the bout's code, and a Pool's duty by no code", async () => {
    windowsAre({});
    const phase = { ...PHASE, tournaments: { ...PHASE.tournaments, weapon: 'longsword' } };
    const bout = matchScoped('L1-PD-M01', '2027-05-23T09:00:00Z', phase);
    bout.matches.pools = { ...bout.matches.pools, sort_order: 3 } as typeof bout.matches.pools;
    const { service } = buildService(rows([bout, poolScoped('pool-duty')]));
    const schedule = await service.getSchedule('e-1', 'p-1', null);
    expect(schedule.refereeSlots.map((s) => s.roundCode)).toEqual(['LSW-P4-M01', '']);
  });

  it("names the fighter's own bout by its code, never by its stored label", async () => {
    windowsAre({});
    matchLengths.mockResolvedValue(new Map([['L1-PD-M01', 5]]));
    const bout = fighterMatch('L1-PD-M01', null, 'published', { id: 'pool-4', name: 'Pool 4' });
    const { service } = buildService(rows([]), {
      registrations: [{ id: 'reg-1', tournament_id: 't-1' }],
      matches: [
        {
          ...bout,
          pools: { name: 'Pool 4', sort_order: 3 },
          phases: {
            ...bout.phases,
            config_json: null,
            tournaments: { ...bout.phases.tournaments, weapon: 'longsword' },
          },
        },
      ],
    });
    const schedule = await service.getSchedule('e-1', 'p-1', null);
    expect(schedule.matches.map((m) => m.roundCode)).toEqual(['LSW-P4-M01']);
  });

  it('ignores a pool bout for the phase spans', async () => {
    windowsAre({});
    const { service } = buildService(rows([]), {
      registrations: [{ id: 'reg-1', tournament_id: 't-1' }],
      matches: [fighterMatch('p', null, 'published', { id: 'pool-1', name: 'Pool 1' })],
    });
    const schedule = await service.getSchedule('e-1', 'p-1', null);
    expect(schedule.phaseSpans).toEqual([]);
    expect(phaseSpans.mock.calls[0]?.[3]).toEqual([]);
  });
});

describe("PublicScheduleService.getSchedule — a fighter's bracket and Swiss phases", () => {
  const inPhase = (
    id: string,
    phaseId: string,
    type: string,
    over: Record<string, unknown> = {},
  ) => {
    const bout = fighterMatch(id, null);
    return { ...bout, phase_id: phaseId, phases: { ...bout.phases, type }, ...over };
  };
  // Léa lost her quarter-final at 10:00 (blue won); the Swiss bout is another Tournament's.
  const lostQuarter = inPhase('qf', 'phase-b', 'single_elim', {
    status: 'completed',
    winner_registration_id: 'reg-2',
    red_score: 3,
    blue_score: 5,
  });

  function run(matches: unknown[]) {
    windowsAre({});
    matchLengths.mockImplementation(
      async (_db, _eventId, inputs) => new Map(inputs.map((input) => [input.id, 10])),
    );
    phaseSpans.mockImplementation(async (_db, _logger, _eventId, phases) =>
      phases.map((phase) => ({
        ...phase,
        startsAt: '2027-05-22T09:00:00.000Z',
        endsAt: '2027-05-22T18:00:00.000Z',
      })),
    );
    const { service } = buildService(rows([]), {
      registrations: [{ id: 'reg-1', tournament_id: 't-1' }],
      matches,
    });
    return service.getSchedule('e-1', 'p-1', null);
  }

  it('hands the helper each bracket and Swiss phase once, and passes its span on', async () => {
    const schedule = await run([
      inPhase('b1', 'phase-b', 'single_elim'),
      inPhase('sw', 'phase-s', 'swiss'),
      inPhase('b2', 'phase-b', 'double_elim'),
    ]);

    expect(phaseSpans.mock.calls[0]?.[3]).toEqual([
      { phaseId: 'phase-b', kind: 'bracket', tournamentName: 'Open' },
      { phaseId: 'phase-s', kind: 'swiss', tournamentName: 'Open' },
    ]);
    expect(schedule.phaseSpans.map((s) => [s.phaseId, s.endsAt])).toEqual([
      ['phase-b', '2027-05-22T18:00:00.000Z'],
      ['phase-s', '2027-05-22T18:00:00.000Z'],
    ]);
    expect(schedule.matches.map((m) => m.phaseId)).toEqual(['phase-b', 'phase-s', 'phase-b']);
  });

  it('ends the bracket for her at the end of the bout that put her out', async () => {
    const schedule = await run([lostQuarter]);

    expect(schedule.phaseSpans).toEqual([
      {
        phaseId: 'phase-b',
        kind: 'bracket',
        tournamentName: 'Open',
        startsAt: '2027-05-22T09:00:00.000Z',
        endsAt: '2027-05-22T10:10:00.000Z',
      },
    ]);
  });

  it('keeps the whole bracket while she has a bout left: the bronze match', async () => {
    const schedule = await run([lostQuarter, inPhase('bronze', 'phase-b', 'single_elim')]);

    expect(schedule.phaseSpans[0]?.endsAt).toBe('2027-05-22T18:00:00.000Z');
  });

  it('never cuts a Swiss phase short: nobody is out of one', async () => {
    const lostSwiss = inPhase('sw', 'phase-s', 'swiss', {
      status: 'completed',
      winner_registration_id: 'reg-2',
      red_score: 3,
      blue_score: 5,
    });
    const schedule = await run([lostSwiss]);

    expect(schedule.phaseSpans[0]?.endsAt).toBe('2027-05-22T18:00:00.000Z');
  });

  it('exposes the assignment id — matchId is empty for every pool-scoped duty', async () => {
    windowsAre({});
    const { service } = buildService(rows([poolScoped('a-1'), poolScoped('a-2')]));
    const schedule = await service.getSchedule('e-1', 'p-1', null);
    expect(schedule.refereeSlots.map((s) => s.matchId)).toEqual(['', '']);
    expect(schedule.refereeSlots.map((s) => s.id)).toEqual(['a-1', 'a-2']);
  });

  it("carries each duty's computed start and end", async () => {
    windowsAre({
      'pool-sat': ['2027-05-22T13:00:00.000Z', '2027-05-22T14:05:00.000Z'],
      qf: ['2027-05-23T09:11:00.000Z', '2027-05-23T09:19:00.000Z'],
    });
    const { service } = buildService(
      rows([poolScoped('pool-sat'), matchScoped('qf', '2027-05-23T09:11:00Z')]),
    );
    const schedule = await service.getSchedule('e-1', 'p-1', null);
    expect(schedule.refereeSlots.map((s) => [s.id, s.startsAt, s.endsAt])).toEqual([
      ['pool-sat', '2027-05-22T13:00:00.000Z', '2027-05-22T14:05:00.000Z'],
      ['qf', '2027-05-23T09:11:00.000Z', '2027-05-23T09:19:00.000Z'],
    ]);
  });

  it("hands the helper each duty's OWN scope, never the Pool its Match sits in", async () => {
    windowsAre({});
    const { service } = buildService(
      rows([poolScoped('pool-duty'), matchScoped('bout-duty', '2027-05-23T09:00:00Z')]),
    );
    await service.getSchedule('e-1', 'p-1', null);
    expect(dutyWindows).toHaveBeenCalledTimes(1);
    // The service's own logger, so a failure is logged under this service's name.
    expect(dutyWindows.mock.calls[0]?.[1]).toBeInstanceOf(Logger);
    expect(dutyWindows.mock.calls[0]?.[2]).toEqual([
      { id: 'pool-duty', eventId: 'e-1', matchId: null, poolId: 'pool-1' },
      { id: 'bout-duty', eventId: 'e-1', matchId: 'm-bout-duty', poolId: null },
    ]);
  });

  it('asks for no time on a duty whose Tournament is not published', async () => {
    windowsAre({});
    const { service } = buildService(
      rows([
        matchScoped('hidden', null, {
          ...PHASE,
          tournaments: { ...PHASE.tournaments, status: 'draft' },
        }),
      ]),
    );
    await service.getSchedule('e-1', 'p-1', null);
    expect(dutyWindows.mock.calls[0]?.[2]).toEqual([]);
  });

  it('reads the duty scope and no stored time, and leaves the order to the service', async () => {
    windowsAre({});
    const { service, chains } = buildService(rows([poolScoped('a-1')]));
    await service.getSchedule('e-1', 'p-1', null);
    const read = chains.get('referee_assignments')?.[0];
    // The double ignores the projection: without this, a stored column could
    // come back into the read and every value above would still be right.
    expect(projection(read)).toBe(
      'id, role, pool_id, match_id, ' +
        'pools ( id, name, phases ( type, config_json, tournaments ( name, slug, status ) ) ), ' +
        'lices ( name ), ' +
        'matches ( id, match_number_label, scheduled_at, bracket_slot_id, pools ( id, name, sort_order ), lices ( name ), ' +
        'bracket_slots ( round ), swiss_rounds ( round_number ), ' +
        'phases ( type, config_json, tournaments ( name, slug, status, weapon ) ) )',
    );
    expect(read?.order).not.toHaveBeenCalled();
  });

  it('keeps a start with no end when that is all the helper could work out', async () => {
    windowsAre({ 'pool-sat': ['2027-05-22T13:00:00.000Z', null] });
    const { service } = buildService(rows([poolScoped('pool-sat')]));
    const schedule = await service.getSchedule('e-1', 'p-1', null);
    expect(schedule.refereeSlots[0]).toMatchObject({
      startsAt: '2027-05-22T13:00:00.000Z',
      endsAt: null,
    });
  });

  it('says so when the duties themselves cannot be read', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { service } = buildService({ data: null, error: { message: 'column does not exist' } });
    const schedule = await service.getSchedule('e-1', 'p-1', null);
    expect(schedule.refereeSlots).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('column does not exist');
  });

  /**
   * Every instant in this payload is UTC and the client groups them into days,
   * which is only correct on the event's clock. Without the zone the client fell
   * back to the UTC day, so a fighter at an event west of UTC saw an afternoon
   * bout filed under tomorrow.
   */
  it('carries the event timezone, so the client can group by the event day', async () => {
    windowsAre({});
    const { service, chains } = buildService(rows([]), { timezone: 'America/Los_Angeles' });
    const schedule = await service.getSchedule('e-1', 'p-1', null);
    expect(schedule.timezone).toBe('America/Los_Angeles');
    // Assert the projection, not only the value: this mock ignores the select
    // string, so dropping `timezone` from the read leaves the fallback in place
    // and a value-only assertion would still pass on Europe/Paris.
    expect(chains.get('events')?.[0]?.select).toHaveBeenCalledWith('timezone');
  });

  it('falls back to the platform default when the event row is unreadable', async () => {
    // `events.timezone` is NOT NULL DEFAULT (migration 0102), so this only fires
    // on an unreadable row — where a wrong day heading beats an empty schedule.
    windowsAre({});
    const { service } = buildService(rows([]), { timezone: null });
    const schedule = await service.getSchedule('e-1', 'p-1', null);
    expect(schedule.timezone).toBe('Europe/Paris');
  });
});

/** What the fallback needs of each published bout: its piste and its time. */
const PLAIN_REF = { id: 'plain', liceId: 'lice-plain', scheduledAt: '2027-05-22T10:00:00Z' };
const TYPED_REF = { id: 'typed', liceId: 'lice-typed', scheduledAt: '2027-05-22T10:00:00Z' };

describe("PublicScheduleService.getSchedule — a fighter's own Match lengths", () => {
  const withMatches = () =>
    buildService(rows([]), {
      registrations: [{ id: 'reg-1', tournament_id: 't-1' }],
      matches: [
        fighterMatch('plain', null),
        fighterMatch('typed', 9),
        fighterMatch('hidden', null, 'draft'),
      ],
    });

  it("gives each published Match its planned length, from the helper's answer", async () => {
    windowsAre({});
    matchLengths.mockImplementation(
      async (_db, _eventId, inputs) =>
        new Map(inputs.map((input) => [input.id, input.plannedDurationOverrideMinutes ?? 5])),
    );
    const { service, chains } = withMatches();

    const schedule = await service.getSchedule('e-1', 'p-1', null);

    expect(schedule.matches.map((m) => [m.id, m.durationMinutes, m.fallbackEndsAt])).toEqual([
      ['plain', 5, null],
      ['typed', 9, null],
    ]);
    // A known length leaves nothing to fall back on.
    expect(nextBoutEnds).not.toHaveBeenCalled();
    expect(matchLengths).toHaveBeenCalledTimes(1);
    expect(matchLengths.mock.calls[0]?.[1]).toBe('e-1');
    expect(matchLengths.mock.calls[0]?.[2]).toEqual([
      { ...PLAIN_REF, phaseId: 'phase-plain', plannedDurationOverrideMinutes: null },
      { ...TYPED_REF, phaseId: 'phase-typed', plannedDurationOverrideMinutes: 9 },
    ]);
    expect(projection(chains.get('matches')?.[0])).toBe(
      'id, match_number_label, status, scheduled_at, phase_id, pool_id, lice_id, planned_duration_override_minutes, ' +
        'red_score, blue_score, winner_registration_id, end_reason, ' +
        'red_registration_id, blue_registration_id, pools ( name, sort_order ), lices ( name ), ' +
        'bracket_slots ( round ), swiss_rounds ( round_number ), ' +
        'phases ( type, config_json, tournaments ( id, name, scoring_config_json, status, weapon ) )',
    );
  });

  it('ends each Match at its next bout instead, and says so, when the sheet cannot be read', async () => {
    windowsAre({});
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    matchLengths.mockRejectedValue(new Error('sheet refused'));
    nextBoutEnds.mockResolvedValue(
      new Map([
        ['plain', '2027-05-22T10:20:00.000Z'],
        ['typed', null],
      ]),
    );
    const { service } = withMatches();

    const schedule = await service.getSchedule('e-1', 'p-1', null);

    expect(schedule.matches.map((m) => [m.id, m.durationMinutes, m.fallbackEndsAt])).toEqual([
      ['plain', null, '2027-05-22T10:20:00.000Z'],
      ['typed', null, null],
    ]);
    // The published bouts only, with their pistes and times, under this service's logger.
    expect(nextBoutEnds).toHaveBeenCalledTimes(1);
    expect(nextBoutEnds.mock.calls[0]?.[1]).toBeInstanceOf(Logger);
    expect(nextBoutEnds.mock.calls[0]?.[2]).toBe('e-1');
    expect(nextBoutEnds.mock.calls[0]?.[3]).toEqual([
      expect.objectContaining(PLAIN_REF),
      expect.objectContaining(TYPED_REF),
    ]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('e-1');
  });
});

describe("PublicScheduleService.getSchedule — a fighter's Pools", () => {
  it('hands the helper each published Pool once, in the order met, and passes its spans on', async () => {
    // Pool A comes back after Pool B; the unpublished Pool and the Swiss bout stay out.
    windowsAre({});
    poolSpans.mockImplementation(async (_db, _logger, _eventId, pools) =>
      pools.map((pool) => ({ ...pool, startsAt: `${pool.poolId}@`, endsAt: `@${pool.poolId}` })),
    );
    const a = { id: 'pool-a', name: 'Pool A' };
    const { service } = buildService(rows([]), {
      registrations: [{ id: 'reg-1', tournament_id: 't-1' }],
      matches: [
        fighterMatch('a1', null, 'published', a),
        fighterMatch('b1', null, 'published', { id: 'pool-b', name: 'Pool B' }),
        fighterMatch('a2', null, 'published', a),
        fighterMatch('hidden', null, 'draft', { id: 'pool-h', name: 'Pool H' }),
        fighterMatch('swiss', null),
      ],
    });

    const schedule = await service.getSchedule('e-1', 'p-1', null);

    expect(poolSpans).toHaveBeenCalledTimes(1);
    expect(poolSpans.mock.calls[0]?.[1]).toBeInstanceOf(Logger);
    expect(poolSpans.mock.calls[0]?.[2]).toBe('e-1');
    expect(poolSpans.mock.calls[0]?.[3]).toEqual([
      { poolId: 'pool-a', poolName: 'Pool A', tournamentName: 'Open' },
      { poolId: 'pool-b', poolName: 'Pool B', tournamentName: 'Open' },
    ]);
    expect(schedule.poolSpans.map((s) => [s.poolId, s.startsAt, s.endsAt])).toEqual([
      ['pool-a', 'pool-a@', '@pool-a'],
      ['pool-b', 'pool-b@', '@pool-b'],
    ]);
    // a1, b1, a2, swiss — the unpublished bout was dropped before any of this.
    expect(schedule.matches.map((m) => m.poolId)).toEqual(['pool-a', 'pool-b', 'pool-a', null]);
  });

  it("ends a Pool at its programme bar's end, not at its last bout (operator, 2026-11-27)", async () => {
    // Laure's Pool 2 runs 09:00 to 11:33; the organiser's Pool bar runs 09:00 to 12:00. Her
    // Workshop clash line read "(09:00–11:33)" under a schedule header that ended at 12:00.
    windowsAre({});
    poolSpans.mockImplementation(async (_db, _logger, _eventId, pools) =>
      pools.map((pool) => ({
        ...pool,
        startsAt: '2027-05-22T07:00:00.000Z',
        endsAt: '2027-05-22T09:33:00.000Z',
      })),
    );
    poolBlocks.mockResolvedValue(
      new Map([
        [
          't-1',
          [
            {
              startMs: Date.parse('2027-05-22T07:00:00.000Z'),
              endMs: Date.parse('2027-05-22T10:00:00.000Z'),
            },
          ],
        ],
      ]),
    );
    const { service } = buildService(rows([]), {
      registrations: [{ id: 'reg-1', tournament_id: 't-1' }],
      matches: [fighterMatch('p1', null, 'published', { id: 'pool-2', name: 'Pool 2' })],
    });

    const schedule = await service.getSchedule('e-1', 'p-1', null);

    expect(poolBlocks).toHaveBeenCalledTimes(1);
    expect(poolBlocks.mock.calls[0]?.[2]).toBe('e-1');
    expect(poolBlocks.mock.calls[0]?.[3]).toEqual(['t-1']);
    expect(schedule.poolSpans.map((s) => [s.poolId, s.startsAt, s.endsAt])).toEqual([
      ['pool-2', '2027-05-22T07:00:00.000Z', '2027-05-22T10:00:00.000Z'],
    ]);
  });
});
