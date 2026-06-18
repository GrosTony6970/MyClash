import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ScheduleGridService, formatBracketPlaceholder } from './schedule-grid.service';

const fromMock = vi.fn();
const mockSupabase = { service: { from: fromMock } };

function makeChain(result: unknown) {
  const promise = Promise.resolve(result);
  const chain = Object.assign(promise, {
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
  });
  for (const key of ['select', 'eq', 'in', 'order', 'limit']) {
    (chain as unknown as Record<string, unknown>)[key] = vi.fn().mockReturnValue(chain);
  }
  return chain;
}

/**
 * Sets up the supabase `from()` mock for the sequential table fetches the
 * service performs:
 *   tournaments → phases → matches → [pools] → [bracket_slots] → vw_tournament_query_matches
 * Pools / bracket_slots are only queried when at least one match has a
 * pool_id / bracket_slot_id. Fighter names come from the
 * vw_tournament_query_matches view, queried whenever there is ≥1 match —
 * so a `names` chain is queued for any non-empty `matches`.
 */
function queueTables(opts: {
  tournaments: unknown;
  phases?: unknown;
  matches?: unknown;
  pools?: unknown;
  bracketSlots?: unknown;
  names?: unknown;
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
  // The service queries the names view after the early-return guard, i.e.
  // only when matches is a non-empty array.
  if (Array.isArray(opts.matches) && opts.matches.length > 0) {
    fromMock.mockReturnValueOnce(makeChain({ data: opts.names ?? [], error: null }));
  }
}

describe('formatBracketPlaceholder', () => {
  it('title-cases winner_of refs and avoids double-prefixing pre-formatted ones', () => {
    expect(formatBracketPlaceholder('winner_of', 'R1P1')).toBe('Winner of R1P1');
    expect(formatBracketPlaceholder('winner_of', 'winner of R1P1')).toBe('Winner of R1P1');
  });

  it('title-cases loser_of refs', () => {
    expect(formatBracketPlaceholder('loser_of', 'R4P2')).toBe('Loser of R4P2');
    expect(formatBracketPlaceholder('loser_of', 'loser of R4P2')).toBe('Loser of R4P2');
  });

  it('prefixes seed sources with "Seed "', () => {
    expect(formatBracketPlaceholder('seed', '3')).toBe('Seed 3');
  });

  it('returns the raw ref for unknown source types so the operator still sees something', () => {
    expect(formatBracketPlaceholder('made_up', 'foo')).toBe('foo');
  });

  it('returns null when either side of the source pair is missing', () => {
    expect(formatBracketPlaceholder(null, 'R1P1')).toBeNull();
    expect(formatBracketPlaceholder('winner_of', null)).toBeNull();
    expect(formatBracketPlaceholder(null, null)).toBeNull();
  });
});

describe('ScheduleGridService', () => {
  let service: ScheduleGridService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ScheduleGridService(mockSupabase as never);
  });

  it('returns matches across pool + bracket phases for the event', async () => {
    queueTables({
      tournaments: [
        { id: 't1', name: 'Longsword Open', color: 'red' },
        { id: 't2', name: 'Saber Cup', color: 'blue' },
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
      names: [
        { match_id: 'match-pool', red_name: 'Red Fighter', blue_name: 'Blue Fighter' },
        // match-bracket has no resolved fighters yet (no view row).
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
    // Tournament color projected onto every match so the FE can tint
    // cards by their parent tournament.
    expect(pool.tournamentColor).toBe('red');
    expect(bracket.tournamentColor).toBe('red');
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

  it('projects the canonical roundCode (LSW-P1-M1) for a pool match', async () => {
    queueTables({
      tournaments: [{ id: 't1', name: 'Longsword Open', weapon: 'Longsword' }],
      phases: [{ id: 'ph-pool', type: 'pool', tournament_id: 't1', config_json: null }],
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
    expect(result[0]!.roundCode).toBe('LSW-P1-M1');
    expect(result[0]!.poolName).toBe('Pool A');
  });

  // bracket_size lives on phases.config_json (jsonb), NOT on tournaments —
  // the column was never created at the SQL level. Without this lookup
  // the bracket round label degrades to `B{round}` (e.g. LSW-B-B2-M1
  // instead of LSW-B-SF-M1) which is how operators previously had to
  // read bracket cards.
  it('resolves bracketSize from phases.config_json for bracket matches', async () => {
    queueTables({
      tournaments: [{ id: 't1', name: 'Longsword Open', weapon: 'Longsword' }],
      phases: [
        { id: 'ph-br', type: 'single_elim', tournament_id: 't1', config_json: { bracketSize: 8 } },
      ],
      matches: [
        {
          id: 'm1',
          match_number_label: '1',
          status: 'scheduled',
          lice_id: null,
          scheduled_at: null,
          phase_id: 'ph-br',
          pool_id: null,
          bracket_slot_id: 'slot-sf-1',
          red_registration_id: null,
          blue_registration_id: null,
        },
      ],
      bracketSlots: [{ id: 'slot-sf-1', round: 2 }],
    });

    const result = await service.listEventSchedule('event-1');
    expect(result).toHaveLength(1);
    // bracketSize 8 + round 2 → semifinal (4 fighters remaining)
    expect(result[0]!.roundCode).toBe('LSW-B-SF-M1');
  });

  // mainBracketSize is the double-elim losers-bracket fallback; the
  // helper at matches.service.ts:148 reads either key.
  it('falls back to mainBracketSize when bracketSize is missing', async () => {
    queueTables({
      tournaments: [{ id: 't1', name: 'Longsword Open', weapon: 'Longsword' }],
      phases: [
        {
          id: 'ph-br',
          type: 'double_elim',
          tournament_id: 't1',
          config_json: { mainBracketSize: 8 },
        },
      ],
      matches: [
        {
          id: 'm1',
          match_number_label: '1',
          status: 'scheduled',
          lice_id: null,
          scheduled_at: null,
          phase_id: 'ph-br',
          pool_id: null,
          bracket_slot_id: 'slot-f-1',
          red_registration_id: null,
          blue_registration_id: null,
        },
      ],
      bracketSlots: [{ id: 'slot-f-1', round: 3 }],
    });

    const result = await service.listEventSchedule('event-1');
    // mainBracketSize 8 + round 3 → final (2 fighters remaining)
    expect(result[0]!.roundCode).toBe('LSW-B-F-M1');
  });

  it('resolves fighter names from the vw_tournament_query_matches view', async () => {
    queueTables({
      tournaments: [{ id: 't1', name: 'Cup' }],
      phases: [{ id: 'ph', type: 'pool', tournament_id: 't1' }],
      matches: [
        {
          id: 'm1',
          match_number_label: 'P1-M1',
          status: 'scheduled',
          lice_id: null,
          scheduled_at: null,
          phase_id: 'ph',
          red_registration_id: 'reg-a',
          blue_registration_id: 'reg-b',
        },
      ],
      names: [{ match_id: 'm1', red_name: 'Alice', blue_name: 'Bob' }],
    });

    const result = await service.listEventSchedule('event-1');
    expect(result[0]!.redFighterName).toBe('Alice');
    expect(result[0]!.blueFighterName).toBe('Bob');

    // queueTables pushes chains in order: tournaments, phases, matches, names.
    // The names view lookup is the 4th from() call; .limit() lifts PostgREST's
    // default 1000-row cap so large events aren't silently truncated.
    const namesChain = fromMock.mock.results[3]!.value;
    expect(namesChain.limit).toHaveBeenCalledWith(1);
  });
});
