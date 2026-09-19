import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ScheduleGridService } from './schedule-grid.service';
import { assertCanReadEvent } from '../../common/auth/event-authz';
import { resolveMatchLengths } from './match-lengths';
import { readProgrammeSheet } from '../programme/programme-sheet';

/**
 * Where a grid card's WIDTH comes from.
 *
 * Its own file rather than more cases in `schedule-grid.service.test.ts`: that
 * one is at the 400-line budget, and it drives `from()` as an ordered queue, so
 * both files mock the same collaborators the same way (see its header).
 *
 * The card used to be five minutes wide, always — a constant shared with the
 * server's occupancy refusal so the two "could not disagree". They agreed with
 * each other and with no organiser. Both read the Event's sheet now.
 */

vi.mock('../../common/auth/event-authz', () => ({
  assertCanReadEvent: vi.fn(() => Promise.resolve()),
}));

vi.mock('./match-lengths', () => ({ resolveMatchLengths: vi.fn() }));
const resolveMatchLengthsMock = vi.mocked(resolveMatchLengths);

/** The Event rests 10 minutes mid-Pool; Longsword ('t1') rests 7. */
const SHEET = { minRestMinutes: 10, tournaments: [{ tournamentId: 't1', minRestMinutes: 7 }] };
vi.mock('../programme/programme-sheet', () => ({ readProgrammeSheet: vi.fn() }));
const readProgrammeSheetMock = vi.mocked(readProgrammeSheet);

const fromMock = vi.fn();
const mockSupabase = { service: { from: fromMock } };

function makeChain(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'in', 'order', 'limit', 'not', 'is']) {
    chain[method] = vi.fn(() => chain);
  }
  chain['then'] = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return chain;
}

const TOURNAMENT = { id: 't1', name: 'Longsword', slug: 'longsword', weapon: 'ls', color: null };
const POOL_PHASE = { id: 'ph-pool', tournament_id: 't1', type: 'pool', config_json: null };

function match(over: Record<string, unknown> = {}) {
  return {
    id: 'm1',
    match_number_label: 'M1',
    status: 'scheduled',
    lice_id: 'lice-1',
    scheduled_at: '2026-06-06T08:00:00.000Z',
    started_at: null,
    ended_at: null,
    phase_id: 'ph-pool',
    pool_id: null,
    bracket_slot_id: null,
    swiss_round_id: null,
    red_registration_id: 'r1',
    blue_registration_id: 'r2',
    planned_duration_override_minutes: null,
    ...over,
  };
}

function queue(matches: unknown[]) {
  fromMock.mockReturnValueOnce(makeChain({ data: [TOURNAMENT], error: null }));
  fromMock.mockReturnValueOnce(makeChain({ data: [POOL_PHASE], error: null }));
  fromMock.mockReturnValueOnce(makeChain({ data: matches, error: null }));
  fromMock.mockReturnValueOnce(makeChain({ data: [], error: null })); // names view
}

function service() {
  return new ScheduleGridService(mockSupabase as never, { assertOrgRole: vi.fn() } as never);
}

describe('ScheduleGridService — a card is as wide as the sheet says', () => {
  beforeEach(() => {
    fromMock.mockReset();
    resolveMatchLengthsMock.mockReset();
    readProgrammeSheetMock.mockReset().mockResolvedValue(SHEET as never);
    vi.mocked(assertCanReadEvent).mockResolvedValue(undefined as never);
  });

  it("gives each card the helper's length for that Match", async () => {
    queue([match({ id: 'm1' }), match({ id: 'm2' })]);
    resolveMatchLengthsMock.mockResolvedValue(
      new Map([
        ['m1', 7],
        ['m2', 12],
      ]),
    );

    const rows = await service().listEventSchedule('e1', () => Promise.resolve('u1'));

    expect(rows.map((r) => [r.id, r.durationMinutes])).toEqual([
      ['m1', 7],
      ['m2', 12],
    ]);
  });

  it("carries each card's typed length, and null where the sheet decides", async () => {
    // The run window opens on this number. `durationMinutes` already applies it,
    // but only this says whether the length was typed or read from the sheet.
    queue([
      match({ id: 'm1' }),
      match({ id: 'm2', planned_duration_override_minutes: 7 }),
      match({ id: 'm3' }),
    ]);
    resolveMatchLengthsMock.mockResolvedValue(
      new Map([
        ['m1', 5],
        ['m2', 7],
        ['m3', 5],
      ]),
    );

    const rows = await service().listEventSchedule('e1', () => Promise.resolve('u1'));

    expect(rows.map((r) => [r.id, r.plannedDurationOverrideMinutes])).toEqual([
      ['m1', null],
      ['m2', 7],
      ['m3', null],
    ]);
  });

  it("hands the helper each Match's phase and its own stored override", async () => {
    queue([match({ id: 'm1', planned_duration_override_minutes: 9 })]);
    resolveMatchLengthsMock.mockResolvedValue(new Map([['m1', 9]]));

    await service().listEventSchedule('e1', () => Promise.resolve('u1'));

    expect(resolveMatchLengthsMock).toHaveBeenCalledTimes(1);
    expect(resolveMatchLengthsMock.mock.calls[0]?.[1]).toBe('e1');
    expect(resolveMatchLengthsMock.mock.calls[0]?.[2]).toEqual([
      { id: 'm1', phaseId: 'ph-pool', plannedDurationOverrideMinutes: 9 },
    ]);
  });

  it('asks for the override column, or the card silently loses it', async () => {
    // The double ignores the projection, so deleting the column from the SELECT
    // leaves every value right and the override unread in production.
    queue([match()]);
    resolveMatchLengthsMock.mockResolvedValue(new Map([['m1', 5]]));

    await service().listEventSchedule('e1', () => Promise.resolve('u1'));

    const matchesChain = fromMock.mock.results[2]?.value as { select: ReturnType<typeof vi.fn> };
    expect(matchesChain.select.mock.calls[0]?.[0]).toContain('planned_duration_override_minutes');
  });

  it('resolves once for the whole grid, not once per card', async () => {
    queue([match({ id: 'm1' }), match({ id: 'm2' }), match({ id: 'm3' })]);
    resolveMatchLengthsMock.mockResolvedValue(
      new Map([
        ['m1', 5],
        ['m2', 5],
        ['m3', 5],
      ]),
    );

    await service().listEventSchedule('e1', () => Promise.resolve('u1'));

    expect(resolveMatchLengthsMock).toHaveBeenCalledTimes(1);
  });

  it("gives a Pool bout its Tournament's mid-Pool rest, and a bout outside a Pool none", async () => {
    fromMock.mockReturnValueOnce(makeChain({ data: [TOURNAMENT], error: null }));
    fromMock.mockReturnValueOnce(makeChain({ data: [POOL_PHASE], error: null }));
    const inPool = match({ id: 'm1', pool_id: 'pool-1' });
    fromMock.mockReturnValueOnce(makeChain({ data: [inPool, match({ id: 'm2' })], error: null }));
    fromMock.mockReturnValueOnce(
      makeChain({ data: [{ id: 'pool-1', name: 'Pool 1', sort_order: 0 }], error: null }),
    );
    fromMock.mockReturnValueOnce(makeChain({ data: [], error: null })); // names view
    resolveMatchLengthsMock.mockResolvedValue(
      new Map([
        ['m1', 5],
        ['m2', 5],
      ]),
    );

    const rows = await service().listEventSchedule('e1', () => Promise.resolve('u1'));

    expect(rows.map((r) => [r.id, r.poolRestMinutes])).toEqual([
      ['m1', 7],
      ['m2', null],
    ]);
    // One read of the sheet, shared with the lengths.
    expect(readProgrammeSheetMock).toHaveBeenCalledTimes(1);
    expect(resolveMatchLengthsMock.mock.calls[0]?.[3]).toBe(SHEET);
  });
});
