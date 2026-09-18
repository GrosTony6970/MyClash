import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveDutyWindows, resolvePoolSpans } from '../schedule/duty-windows';
import { resolveMatchLengths } from '../schedule/match-lengths';
import { resolveNextBoutEnds } from '../schedule/next-bout-end';
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
}));
vi.mock('../schedule/match-lengths', () => ({ resolveMatchLengths: vi.fn() }));
vi.mock('../schedule/next-bout-end', () => ({ resolveNextBoutEnds: vi.fn() }));

const dutyWindows = vi.mocked(resolveDutyWindows);
const poolSpans = vi.mocked(resolvePoolSpans);
const matchLengths = vi.mocked(resolveMatchLengths);
const nextBoutEnds = vi.mocked(resolveNextBoutEnds);

/** Unless a case says otherwise, every Pool comes back untimed, and no bout has a next bout. */
beforeEach(() => {
  poolSpans.mockImplementation(async (_db, _logger, _eventId, pools) =>
    pools.map((pool) => ({ ...pool, startsAt: null, endsAt: null })),
  );
  nextBoutEnds.mockImplementation(
    async (_db, _logger, _eventId, bouts) => new Map(bouts.map((bout) => [bout.id, null])),
  );
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
  matchLengths.mockReset();
  nextBoutEnds.mockReset();
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

  it('asks for no time on a duty whose phase is not published', async () => {
    windowsAre({});
    const { service } = buildService(
      rows([matchScoped('hidden', null, { ...PHASE, visibility_status: 'draft' })]),
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
        'pools ( id, name, phases ( type, config_json, visibility_status, tournaments ( name, slug ) ) ), ' +
        'lices ( name ), ' +
        'matches ( id, match_number_label, scheduled_at, bracket_slot_id, pools ( id, name ), lices ( name ), ' +
        'phases ( visibility_status, type, config_json, tournaments ( name, slug ) ) )',
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
        'red_registration_id, blue_registration_id, pools ( name ), lices ( name ), ' +
        'phases ( visibility_status, type, tournaments ( id, name, scoring_config_json ) )',
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
});
