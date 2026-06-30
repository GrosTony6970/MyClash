import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ScoringService } from './scoring.service';

// A Supabase query chain that is BOTH thenable (so a terminal `.order()` / `.eq()`
// awaits to {data,error}) and resolves `.maybeSingle()` / `.single()`.
function thenableResult(data: unknown) {
  const result = { data, error: null };
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'order', 'in', 'insert', 'delete', 'limit', 'update']) {
    chain[m] = vi.fn(() => chain);
  }
  chain['maybeSingle'] = vi.fn().mockResolvedValue(result);
  chain['single'] = vi.fn().mockResolvedValue(result);
  (chain as { then?: unknown })['then'] = (resolve: (v: unknown) => unknown) => resolve(result);
  return chain;
}

// A bracket phase carrying a per-phase best-of config (bracket = N).
const bracketPhase = (bestOf: number, pointCap = 3) => ({
  type: 'single_elim',
  tournaments: {
    ruleset_config: {
      matchFormat: { pointCap, bestOf: { pool: 1, bracket: bestOf, finals: bestOf } },
    },
    scoring_config_json: null,
  },
});

function matchRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'm1',
    red_registration_id: 'red',
    blue_registration_id: 'blue',
    ruleset_code: 'TF_v1',
    ruleset_version: '1.0.0',
    status: 'running',
    winner_registration_id: null,
    match_number_label: 'QF1',
    current_round: 1,
    rounds_json: null,
    red_round_wins: 0,
    blue_round_wins: 0,
    awaiting_round_advance: false,
    phases: bracketPhase(3),
    ...overrides,
  };
}

function ex(seq: number, color: 'red' | 'blue', value: number, round = 1) {
  return {
    id: `e${seq}`,
    client_uuid: `u${seq}`,
    match_id: 'm1',
    sequence: seq,
    type: 'clean',
    occurred_at: '2026-01-01T00:00:00Z',
    first_striker_color: color,
    first_strike_value: value,
    afterblow_value: null,
    no_exchange_reason: null,
    round_number: round,
    voided: false,
  };
}

describe('ScoringService — best-of rounds', () => {
  const fromMock = vi.fn();
  const supabase = { service: { from: fromMock } };
  const rulesets = { resolve: vi.fn().mockResolvedValue(null) };
  const clock = {
    getClockState: vi.fn().mockResolvedValue({ status: 'halted' }),
    clockAction: vi.fn().mockResolvedValue(undefined),
  };
  let service: ScoringService;
  let lastUpdate: Record<string, unknown> | null;

  // recompute fetches: matches → exchanges → match_penalties, then updates matches.
  function wire(match: Record<string, unknown>, exchanges: unknown[]) {
    lastUpdate = null;
    const updateChain = thenableResult({ id: 'm1' });
    (updateChain['update'] as ReturnType<typeof vi.fn>).mockImplementation(
      (patch: Record<string, unknown>) => {
        lastUpdate = patch;
        return updateChain;
      },
    );
    fromMock
      .mockReturnValueOnce(thenableResult(match))
      .mockReturnValueOnce(thenableResult(exchanges))
      .mockReturnValueOnce(thenableResult([]))
      .mockReturnValueOnce(updateChain);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    clock.getClockState.mockResolvedValue({ status: 'halted' });
    rulesets.resolve.mockResolvedValue(null);
    service = new ScoringService(supabase as never, rulesets as never, clock as never);
  });

  it('keeps the round open while below the point cap', async () => {
    wire(matchRow(), [ex(1, 'red', 2)]);
    await service.recomputeMatchScore('m1');
    expect(lastUpdate).toMatchObject({
      red_score: 2,
      blue_score: 0,
      current_round: 1,
      awaiting_round_advance: false,
    });
    expect(lastUpdate?.['status']).toBeUndefined();
  });

  it('closes a non-clinching round on the cap and awaits advance', async () => {
    // Red reaches the cap (3) in round 1 → wins it, but BO3 needs 2 round wins.
    wire(matchRow(), [ex(1, 'red', 2), ex(2, 'red', 1)]);
    await service.recomputeMatchScore('m1');
    expect(lastUpdate).toMatchObject({
      awaiting_round_advance: true,
      red_round_wins: 1,
      blue_round_wins: 0,
    });
    expect(lastUpdate?.['status']).toBeUndefined();
    const rounds = lastUpdate?.['rounds_json'] as Array<Record<string, unknown>>;
    expect(rounds).toHaveLength(1);
    expect(rounds[0]).toMatchObject({ round: 1, winnerColor: 'red', endReason: 'first_to_points' });
  });

  it('completes the match when the clinching round is won', async () => {
    const match = matchRow({
      current_round: 2,
      red_round_wins: 1,
      rounds_json: [
        { round: 1, redScore: 3, blueScore: 1, winnerColor: 'red', endReason: 'first_to_points' },
      ],
    });
    // Round-2 exchanges (round 1 ones are present but ignored as the closed round).
    wire(match, [ex(1, 'red', 2, 1), ex(2, 'red', 1, 1), ex(3, 'red', 2, 2), ex(4, 'red', 1, 2)]);
    await service.recomputeMatchScore('m1');
    expect(lastUpdate).toMatchObject({
      status: 'completed',
      winner_registration_id: 'red',
      red_round_wins: 2,
      awaiting_round_advance: false,
    });
    // The clinching round's clock-end side effect fired.
    expect(clock.clockAction).toHaveBeenCalledWith(
      'm1',
      'end',
      expect.any(String),
      expect.anything(),
    );
  });

  it('does not re-close a round already recorded (idempotent recompute while awaiting)', async () => {
    const match = matchRow({
      current_round: 1,
      red_round_wins: 1,
      awaiting_round_advance: true,
      rounds_json: [
        { round: 1, redScore: 3, blueScore: 1, winnerColor: 'red', endReason: 'first_to_points' },
      ],
    });
    wire(match, [ex(1, 'red', 2, 1), ex(2, 'red', 1, 1)]);
    await service.recomputeMatchScore('m1');
    // Still awaiting (1 of 2 wins); the closed round is not duplicated.
    expect(lastUpdate).toMatchObject({ awaiting_round_advance: true, red_round_wins: 1 });
    expect(lastUpdate?.['status']).toBeUndefined();
  });

  it('BO5: a won round at 1-1 makes it 2-1 and keeps the series open (needs 3)', async () => {
    const match = matchRow({
      phases: bracketPhase(5),
      current_round: 3,
      red_round_wins: 1,
      blue_round_wins: 1,
      rounds_json: [
        { round: 1, redScore: 1, blueScore: 3, winnerColor: 'blue', endReason: 'first_to_points' },
        { round: 2, redScore: 3, blueScore: 2, winnerColor: 'red', endReason: 'first_to_points' },
      ],
    });
    // Round-3 exchanges: red reaches the cap (3) and wins the round.
    wire(match, [ex(1, 'red', 2, 3), ex(2, 'red', 1, 3)]);
    await service.recomputeMatchScore('m1');
    expect(lastUpdate).toMatchObject({
      awaiting_round_advance: true,
      red_round_wins: 2,
      blue_round_wins: 1,
    });
    expect(lastUpdate?.['status']).toBeUndefined(); // BO5 needs 3 round wins
  });

  it('pool phase resolves to BO1 → a single won round completes the match', async () => {
    const poolPhase = {
      type: 'pool',
      tournaments: {
        ruleset_config: {
          matchFormat: { pointCap: 3, bestOf: { pool: 1, bracket: 3, finals: 3 } },
        },
        scoring_config_json: null,
      },
    };
    const match = matchRow({ phases: poolPhase, match_number_label: 'P1M1' });
    // Red reaches the cap → a BO1 pool match completes outright (single round,
    // no "awaiting advance" — that's the best-of path only).
    wire(match, [ex(1, 'red', 2), ex(2, 'red', 1)]);
    await service.recomputeMatchScore('m1');
    expect(lastUpdate).toMatchObject({ status: 'completed', winner_registration_id: 'red' });
    expect(lastUpdate?.['awaiting_round_advance']).not.toBe(true);
  });

  it('advanceRound rejects when no round is awaiting advance', async () => {
    fromMock.mockReturnValueOnce(
      thenableResult({
        id: 'm1',
        status: 'running',
        awaiting_round_advance: false,
        current_round: 1,
      }),
    );
    await expect(service.advanceRound('m1')).rejects.toThrow('No round is awaiting advance');
  });

  it('advanceRound rejects when the match is already completed', async () => {
    fromMock.mockReturnValueOnce(
      thenableResult({
        id: 'm1',
        status: 'completed',
        awaiting_round_advance: true,
        current_round: 2,
      }),
    );
    await expect(service.advanceRound('m1')).rejects.toThrow('Match is already completed');
  });
});
