import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ScheduleGridService } from './schedule-grid.service';

const fromMock = vi.fn();
const mockSupabase = { service: { from: fromMock } };

function makeChain(result: unknown) {
  const promise = Promise.resolve(result);
  const chain = Object.assign(promise, {
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    order: vi.fn(),
  });
  for (const key of ['select', 'eq', 'in', 'order']) {
    (chain as unknown as Record<string, unknown>)[key] = vi.fn().mockReturnValue(chain);
  }
  return chain;
}

/**
 * Sets up the supabase `from()` mock for the sequential table fetches the
 * service performs:
 *   tournaments → phases → matches → [pools] → [bracket_slots] → registrations → persons
 * Pools / bracket_slots are only queried when at least one match has a
 * pool_id / bracket_slot_id, so the test must mirror that conditional.
 */
function queueTables(opts: {
  tournaments: unknown;
  phases?: unknown;
  matches?: unknown;
  pools?: unknown;
  bracketSlots?: unknown;
  registrations?: unknown;
  persons?: unknown;
}) {
  fromMock.mockReturnValueOnce(makeChain({ data: opts.tournaments, error: null }));
  if (opts.phases !== undefined) {
    fromMock.mockReturnValueOnce(makeChain({ data: opts.phases, error: null }));
  }
  if (opts.matches !== undefined) {
    fromMock.mockReturnValueOnce(makeChain({ data: opts.matches, error: null }));
  }
  if (opts.pools !== undefined) {
    fromMock.mockReturnValueOnce(makeChain({ data: opts.pools, error: null }));
  }
  if (opts.bracketSlots !== undefined) {
    fromMock.mockReturnValueOnce(makeChain({ data: opts.bracketSlots, error: null }));
  }
  if (opts.registrations !== undefined) {
    fromMock.mockReturnValueOnce(makeChain({ data: opts.registrations, error: null }));
  }
  if (opts.persons !== undefined) {
    fromMock.mockReturnValueOnce(makeChain({ data: opts.persons, error: null }));
  }
}

describe('ScheduleGridService', () => {
  let service: ScheduleGridService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ScheduleGridService(mockSupabase as never);
  });

  it('returns matches across pool + bracket phases for the event', async () => {
    queueTables({
      tournaments: [
        { id: 't1', name: 'Longsword Open' },
        { id: 't2', name: 'Saber Cup' },
      ],
      phases: [
        { id: 'ph-pool', type: 'pool', tournament_id: 't1' },
        { id: 'ph-bracket', type: 'single_elim', tournament_id: 't1' },
        { id: 'ph-pool-2', type: 'pool', tournament_id: 't2' },
      ],
      matches: [
        {
          id: 'match-pool',
          match_number_label: 'P1-M1',
          status: 'scheduled',
          lice_id: 'lice-1',
          scheduled_at: '2026-05-30T10:00:00.000Z',
          phase_id: 'ph-pool',
          red_registration_id: 'reg-red',
          blue_registration_id: 'reg-blue',
        },
        {
          id: 'match-bracket',
          match_number_label: 'QF-1',
          status: 'scheduled',
          lice_id: 'lice-2',
          scheduled_at: '2026-05-30T14:00:00.000Z',
          phase_id: 'ph-bracket',
          red_registration_id: null,
          blue_registration_id: null,
        },
      ],
      registrations: [
        { id: 'reg-red', person_id: 'p-red' },
        { id: 'reg-blue', person_id: 'p-blue' },
      ],
      persons: [
        { id: 'p-red', display_name: 'Red Fighter', given_name: 'Red', family_name: 'Fighter' },
        { id: 'p-blue', display_name: 'Blue Fighter', given_name: 'Blue', family_name: 'Fighter' },
      ],
    });

    const result = await service.listEventSchedule('event-1');
    expect(result).toHaveLength(2);
    const pool = result.find((m) => m.id === 'match-pool')!;
    const bracket = result.find((m) => m.id === 'match-bracket')!;
    expect(pool.tournamentName).toBe('Longsword Open');
    expect(pool.phaseType).toBe('pool');
    expect(pool.redFighterName).toBe('Red Fighter');
    expect(bracket.phaseType).toBe('single_elim');
    expect(bracket.tournamentName).toBe('Longsword Open');
    // Bracket round 2+ matches have null registrations until the bracket advances.
    expect(bracket.redFighterName).toBeNull();
  });

  it('returns matches with null scheduled_at so the unscheduled sidebar can render them', async () => {
    queueTables({
      tournaments: [{ id: 't1', name: 'Cup' }],
      phases: [{ id: 'ph-pool', type: 'pool', tournament_id: 't1' }],
      matches: [
        {
          id: 'match-1',
          match_number_label: 'P1-M1',
          status: 'scheduled',
          lice_id: null,
          scheduled_at: null,
          phase_id: 'ph-pool',
          red_registration_id: null,
          blue_registration_id: null,
        },
      ],
    });

    const result = await service.listEventSchedule('event-1');
    expect(result).toHaveLength(1);
    expect(result[0]!.scheduledAt).toBeNull();
    expect(result[0]!.liceId).toBeNull();
  });

  it('returns an empty list when the event has no tournaments', async () => {
    queueTables({ tournaments: [] });
    await expect(service.listEventSchedule('event-1')).resolves.toEqual([]);
  });

  it('returns an empty list when phases exist but no matches do', async () => {
    queueTables({
      tournaments: [{ id: 't1', name: 'Cup' }],
      phases: [{ id: 'ph-pool', type: 'pool', tournament_id: 't1' }],
      matches: [],
    });
    await expect(service.listEventSchedule('event-1')).resolves.toEqual([]);
  });

  it('projects the canonical roundCode (LSW-P1-ML1-PA-M1) for a pool match', async () => {
    queueTables({
      tournaments: [{ id: 't1', name: 'Longsword Open', weapon: 'Longsword', bracket_size: 8 }],
      phases: [{ id: 'ph-pool', type: 'pool', tournament_id: 't1' }],
      matches: [
        {
          id: 'm1',
          match_number_label: 'L1-PA-M1',
          status: 'scheduled',
          lice_id: null,
          scheduled_at: null,
          phase_id: 'ph-pool',
          pool_id: 'pool-1',
          bracket_slot_id: null,
          red_registration_id: null,
          blue_registration_id: null,
        },
      ],
      pools: [{ id: 'pool-1', name: 'Pool A', sort_order: 0 }],
    });

    const result = await service.listEventSchedule('event-1');
    expect(result).toHaveLength(1);
    expect(result[0]!.roundCode).toBe('LSW-P1-ML1-PA-M1');
    expect(result[0]!.poolName).toBe('Pool A');
  });
});
