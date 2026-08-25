import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ScoringService } from './scoring.service';
import { Generic_PointsCap } from '@myclash/rulesets';

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

/** One card, as `recomputeBestOfRounds` reads it: delta, side, and its round. */
function pen(registrationId: 'red' | 'blue', scoreDelta: number, round = 1) {
  return { score_delta: scoreDelta, registration_id: registrationId, round_number: round };
}

/** A double, which counts toward a doubles ceiling but scores for nobody. */
function dbl(seq: number, round = 1) {
  return {
    ...ex(seq, 'red', 1, round),
    type: 'double',
    first_striker_color: null,
    first_strike_value: null,
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
  const matchCompletion = {
    onMatchCompleted: vi.fn().mockResolvedValue(undefined),
    onMatchUncompleted: vi.fn().mockResolvedValue(undefined),
  };
  let service: ScoringService;
  let lastUpdate: Record<string, unknown> | null;

  // recompute fetches: matches → exchanges → match_penalties, then updates matches.
  function wire(match: Record<string, unknown>, exchanges: unknown[], penalties: unknown[] = []) {
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
      .mockReturnValueOnce(thenableResult(penalties))
      .mockReturnValueOnce(updateChain);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    clock.getClockState.mockResolvedValue({ status: 'halted' });
    rulesets.resolve.mockResolvedValue(null);
    matchCompletion.onMatchUncompleted.mockResolvedValue(undefined);
    service = new ScoringService(
      supabase as never,
      rulesets as never,
      clock as never,
      matchCompletion as never,
    );
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

  /**
   * A card belongs to the round it was given in (migration 0191).
   *
   * Before that column existed, every non-voided card in the bout was added to
   * whichever round was open. In a BO3 a yellow from round 1 kept subtracting
   * in rounds 2 and 3 — and round 1's snapshot in `rounds_json` had already
   * banked it, so the same card was counted three times over a series.
   */
  it('a card from a CLOSED round does not follow the fighter into the next one', async () => {
    const match = matchRow({
      current_round: 2,
      red_round_wins: 1,
      rounds_json: [
        { round: 1, redScore: 3, blueScore: 1, winnerColor: 'red', endReason: 'first_to_points' },
      ],
    });
    // Round 2 is level at 1-1 on exchanges. Red carries a -1 card from round 1,
    // which round 1 already paid for.
    wire(match, [ex(1, 'red', 3, 1), ex(2, 'red', 1, 2), ex(3, 'blue', 1, 2)], [pen('red', -1, 1)]);

    await service.recomputeMatchScore('m1');

    expect(lastUpdate).toMatchObject({ red_score: 1, blue_score: 1, current_round: 2 });
  });

  it('a card given in the OPEN round is subtracted from it', async () => {
    const match = matchRow({
      current_round: 2,
      red_round_wins: 1,
      rounds_json: [
        { round: 1, redScore: 3, blueScore: 1, winnerColor: 'red', endReason: 'first_to_points' },
      ],
    });
    wire(match, [ex(1, 'red', 3, 1), ex(2, 'red', 1, 2), ex(3, 'blue', 1, 2)], [pen('red', -1, 2)]);

    await service.recomputeMatchScore('m1');

    expect(lastUpdate).toMatchObject({ red_score: 0, blue_score: 1, current_round: 2 });
  });

  it('a row written before the column existed reads as round 1', async () => {
    // `?? 1` in the filter, matching the exchange filter beside it. Such a row
    // belongs to round 1, which is where a single-round match's cards are.
    const match = matchRow({ current_round: 1 });
    wire(match, [ex(1, 'red', 2)], [{ score_delta: -1, registration_id: 'red' }]);

    await service.recomputeMatchScore('m1');

    expect(lastUpdate).toMatchObject({ red_score: 1 });
  });

  /**
   * The round lifecycle applies the doubles ceiling from the tournament's match
   * format, and `evaluateRound` is deliberately ruleset-blind. Generic_PointsCap
   * has no ceiling, so the format it plays under must not carry one — otherwise
   * a round of a ruleset with no such rule closes on it anyway.
   */
  it('does not close a Generic_PointsCap round on the doubles ceiling', async () => {
    rulesets.resolve.mockResolvedValue(Generic_PointsCap);
    const poolPhase = {
      type: 'pool',
      tournaments: {
        ruleset_config: {
          matchFormat: {
            pointCap: 10,
            maxDoubleHits: 2,
            bestOf: { pool: 3, bracket: 1, finals: 1 },
          },
        },
        scoring_config_json: null,
      },
    };
    const match = matchRow({
      phases: poolPhase,
      match_number_label: 'P1M1',
      ruleset_code: 'Generic_PointsCap',
    });
    // Three doubles against a ceiling of two: TF_v1 would close the round here.
    wire(match, [ex(1, 'red', 1), dbl(2), dbl(3), dbl(4)]);

    await service.recomputeMatchScore('m1');

    expect(lastUpdate?.['rounds_json']).toBeUndefined();
    expect(lastUpdate?.['awaiting_round_advance']).toBe(false);
    // And the hit still counts — the ceiling did not zero the round either.
    expect(lastUpdate).toMatchObject({ red_score: 1 });
  });

  /**
   * The round-end decision and the score recorded for that round are ONE number.
   *
   * `recomputeBestOfRounds` used to score the round, ask whether it was over,
   * and only then add the cards — so a round could be snapshotted at 2 under a
   * verdict taken on 3. Same split `a81fb0cf` closed for a single fight; it had
   * to wait for a card to carry its round (migration 0191).
   */
  it('a card that takes a fighter to the cap CLOSES the round', async () => {
    // Red is on 2 of a cap of 3 and blue concedes a penalty point, taking red
    // to 3. Decided on the bare exchanges this round would not close at all.
    wire(matchRow(), [ex(1, 'red', 2)], [pen('red', 1, 1)]);

    await service.recomputeMatchScore('m1');

    expect(lastUpdate).toMatchObject({
      red_score: 3,
      awaiting_round_advance: true,
      red_round_wins: 1,
    });
    const rounds = lastUpdate?.['rounds_json'] as Array<Record<string, unknown>>;
    expect(rounds[0]).toMatchObject({ redScore: 3, winnerColor: 'red' });
  });

  it('a card that drops the leader below the cap leaves the round open', async () => {
    // The mirror, and the control on the case above: red reaches the cap on
    // exchanges alone, then loses a point to a card. Decided on the bare
    // exchanges the round closed anyway — banking a snapshot of 2 under a
    // 'first_to_points' verdict nothing on the board supported.
    wire(matchRow(), [ex(1, 'red', 3)], [pen('red', -1, 1)]);

    await service.recomputeMatchScore('m1');

    expect(lastUpdate).toMatchObject({ red_score: 2, awaiting_round_advance: false });
    expect(lastUpdate?.['rounds_json']).toBeUndefined();
  });

  /** A card can now close a round, so voiding it has to reopen one. */
  it('voiding the card that closed a round puts that round back on the board', async () => {
    // Round 1 was closed at 3-0 by a +1 card; the card is voided, so the
    // recompute sees 2 on the board under a round recorded as won.
    const match = matchRow({
      current_round: 1,
      red_round_wins: 1,
      awaiting_round_advance: true,
      rounds_json: [
        { round: 1, redScore: 3, blueScore: 0, winnerColor: 'red', endReason: 'first_to_points' },
      ],
    });
    wire(match, [ex(1, 'red', 2)], []);

    await service.recomputeMatchScore('m1');

    expect(lastUpdate).toMatchObject({
      red_score: 2,
      rounds_json: null,
      red_round_wins: 0,
      blue_round_wins: 0,
      awaiting_round_advance: false,
      current_round: 1,
    });
  });

  it('voiding the card that closed the CLINCHING round un-completes the bout too', async () => {
    // BO3 at 2-0: round 2 was closed by a card and took the series with it.
    const match = matchRow({
      status: 'completed',
      winner_registration_id: 'red',
      current_round: 2,
      red_round_wins: 2,
      rounds_json: [
        { round: 1, redScore: 3, blueScore: 0, winnerColor: 'red', endReason: 'first_to_points' },
        { round: 2, redScore: 3, blueScore: 1, winnerColor: 'red', endReason: 'first_to_points' },
      ],
    });
    wire(match, [ex(1, 'red', 3, 1), ex(2, 'red', 2, 2), ex(3, 'blue', 1, 2)], []);

    await service.recomputeMatchScore('m1');

    // The side effects ran, and the result columns moved with them.
    expect(matchCompletion.onMatchUncompleted).toHaveBeenCalledWith(
      'm1',
      expect.objectContaining({ discardDependents: false }),
    );
    expect(lastUpdate).toMatchObject({
      status: 'paused',
      winner_registration_id: null,
      end_reason: null,
      ended_at: null,
      red_round_wins: 1,
      awaiting_round_advance: false,
    });
    expect(lastUpdate?.['rounds_json']).toHaveLength(1);
  });

  it('a REFUSED reopen leaves the round closed and the series standing', async () => {
    // onMatchUncompleted refuses on a frozen result, an active forfeit, a Swiss
    // advance or a dependent bout already fought. There is no transaction, so a
    // refusal must leave BOTH halves untouched rather than half of each.
    matchCompletion.onMatchUncompleted.mockRejectedValueOnce(new Error('result is frozen'));
    const match = matchRow({
      status: 'completed',
      winner_registration_id: 'red',
      current_round: 2,
      red_round_wins: 2,
      rounds_json: [
        { round: 1, redScore: 3, blueScore: 0, winnerColor: 'red', endReason: 'first_to_points' },
        { round: 2, redScore: 3, blueScore: 1, winnerColor: 'red', endReason: 'first_to_points' },
      ],
    });
    wire(match, [ex(1, 'red', 3, 1), ex(2, 'red', 2, 2), ex(3, 'blue', 1, 2)], []);

    await service.recomputeMatchScore('m1');

    expect(lastUpdate?.['rounds_json']).toBeUndefined();
    expect(lastUpdate?.['status']).toBeUndefined();
  });

  it('a round closed on TIME is not reopened when a card is voided', async () => {
    // The operator ended that round. `rounds_json` exists because a time-ended
    // round cannot be derived back from its exchanges, so nothing here may
    // second-guess it — only the engine's own closures reopen.
    const match = matchRow({
      current_round: 1,
      red_round_wins: 1,
      awaiting_round_advance: true,
      rounds_json: [
        { round: 1, redScore: 2, blueScore: 1, winnerColor: 'red', endReason: 'time_limit' },
      ],
    });
    wire(match, [ex(1, 'red', 1), ex(2, 'blue', 1)], []);

    await service.recomputeMatchScore('m1');

    expect(lastUpdate?.['rounds_json']).toBeUndefined();
    expect(lastUpdate).toMatchObject({ awaiting_round_advance: true, red_round_wins: 1 });
  });

  /**
   * A series that runs out of rounds.
   *
   * Round wins used to be the ONLY way out, so a series carrying drawn rounds
   * never reached the target: `advanceRound` kept opening rounds and the pad
   * read "Round 4/3". Drawn rounds are reachable wherever the organiser allowed
   * them — the doubles ceiling in a pool, below.
   */
  describe('a series whose rounds are spent', () => {
    const CEILING_POOL = {
      type: 'pool',
      tournaments: {
        ruleset_config: {
          matchFormat: {
            pointCap: 3,
            maxDoubleHits: 2,
            bestOf: { pool: 3, bracket: 1, finals: 1 },
          },
        },
        scoring_config_json: null,
      },
    };
    /** A pool BO3 on its LAST round, with `closed` already behind it. */
    const lastRound = (closed: Array<Record<string, unknown>>) =>
      matchRow({
        phases: CEILING_POOL,
        match_number_label: 'L1-P1-M01',
        current_round: 3,
        rounds_json: closed,
        red_round_wins: closed.filter((r) => r['winnerColor'] === 'red').length,
        blue_round_wins: closed.filter((r) => r['winnerColor'] === 'blue').length,
      });
    const wonBy = (round: number, winnerColor: 'red' | 'blue') => ({
      round,
      redScore: winnerColor === 'red' ? 3 : 0,
      blueScore: winnerColor === 'blue' ? 3 : 0,
      winnerColor,
      endReason: 'first_to_points',
    });
    const ceilingDraw = (round: number) => ({
      round,
      redScore: 0,
      blueScore: 0,
      winnerColor: null,
      endReason: 'max_doubles',
    });
    /** Two doubles in round 3 — the ceiling, so round 3 closes drawn. */
    const ceilingInRound3 = [dbl(1, 3), dbl(2, 3)];

    it('goes to whoever leads on ROUND WINS without reaching the target', async () => {
      // Red took round 1; the ceiling drew rounds 2 and 3. Red never reached 2
      // round wins, and this is the series that used to run to round 4.
      wire(lastRound([wonBy(1, 'red'), ceilingDraw(2)]), ceilingInRound3);

      await service.recomputeMatchScore('m1');

      expect(lastUpdate).toMatchObject({
        status: 'completed',
        winner_registration_id: 'red',
        awaiting_round_advance: false,
        red_round_wins: 1,
        blue_round_wins: 0,
      });
    });

    it('records a spent series as `rounds_spent`, NOT as the last round`s ceiling', async () => {
      // `isDoubleLossBout` reads 'max_doubles' as a loss for BOTH, and
      // `compact_fighter_stats` repeats the literal in SQL — so borrowing the
      // round's reason would record a loss for the fighter this row names as
      // the winner.
      wire(lastRound([wonBy(1, 'red'), ceilingDraw(2)]), ceilingInRound3);

      await service.recomputeMatchScore('m1');

      expect(lastUpdate?.['end_reason']).toBe('rounds_spent');
    });

    it('is a DRAWN series when the round wins are level', async () => {
      // One round each, and the ceiling drew the decider. Not a loss for both:
      // each of them won a round.
      wire(lastRound([wonBy(1, 'red'), wonBy(2, 'blue')]), ceilingInRound3);

      await service.recomputeMatchScore('m1');

      expect(lastUpdate).toMatchObject({
        status: 'completed',
        winner_registration_id: null,
        end_reason: 'rounds_spent',
      });
    });

    it('keeps the ceiling result when EVERY round was a double loss', async () => {
      // Then it describes the whole series, and the organiser's ruling for the
      // phase survives into the standings.
      wire(lastRound([ceilingDraw(1), ceilingDraw(2)]), ceilingInRound3);

      await service.recomputeMatchScore('m1');

      expect(lastUpdate).toMatchObject({
        status: 'completed',
        winner_registration_id: null,
        end_reason: 'max_doubles',
      });
    });

    it('does not put a spent series back to awaiting advance on a recompute', async () => {
      // The last round is already closed, so this is the idempotent branch — it
      // asks the same `seriesResult` the closure did. The row is still
      // `running`, which is what makes the question a real one: the status
      // check alone would answer it for a completed row whatever the series
      // said, and awaiting advance on a spent series is the state that let the
      // round number climb past `bestOf`.
      const closed = [wonBy(1, 'red'), ceilingDraw(2), ceilingDraw(3)];
      wire(
        matchRow({
          phases: CEILING_POOL,
          match_number_label: 'L1-P1-M01',
          status: 'running',
          current_round: 3,
          rounds_json: closed,
          red_round_wins: 1,
        }),
        ceilingInRound3,
      );

      await service.recomputeMatchScore('m1');

      expect(lastUpdate?.['awaiting_round_advance']).toBe(false);
    });
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

// ── The single-fight path ────────────────────────────────────────────────────

/**
 * `recomputeMatchScore`'s single-fight branch had NO test at all: the suite
 * above only exercises best-of rounds. What is pinned here is that the end
 * decision and the winner read the SAME score — the penalised one.
 *
 * The mock is the ordered sequence `wire()` uses, and it desyncs if a read is
 * added or reordered: matches → exchanges → match_penalties → update.
 */
describe('ScoringService — a single fight, penalties included', () => {
  const fromMock = vi.fn();
  const supabase = { service: { from: fromMock } };
  const rulesets = { resolve: vi.fn().mockResolvedValue(null) };
  const clock = {
    getClockState: vi.fn().mockResolvedValue({ status: 'halted' }),
    clockAction: vi.fn().mockResolvedValue(undefined),
  };
  const matchCompletion = {
    onMatchCompleted: vi.fn().mockResolvedValue(undefined),
    onMatchUncompleted: vi.fn().mockResolvedValue(undefined),
  };
  let service: ScoringService;
  let lastUpdate: Record<string, unknown> | null;

  /** A bout with no best-of, so it takes the single-fight branch. */
  const singleFightPhase = (over: Record<string, unknown> = {}) => ({
    type: 'single_elim',
    tournaments: {
      ruleset_config: { matchFormat: { pointCap: 3, bestOf: { pool: 1, bracket: 1, finals: 1 } } },
      scoring_config_json: null,
      ...over,
    },
  });

  function wireSingle(
    match: Record<string, unknown>,
    exchanges: unknown[],
    penalties: unknown[] = [],
  ) {
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
      .mockReturnValueOnce(thenableResult(penalties))
      .mockReturnValueOnce(updateChain);
  }

  const penalty = (registrationId: string, delta: number) => ({
    score_delta: delta,
    registration_id: registrationId,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    clock.getClockState.mockResolvedValue({ status: 'halted' });
    rulesets.resolve.mockResolvedValue(null);
    service = new ScoringService(
      supabase as never,
      rulesets as never,
      clock as never,
      matchCompletion as never,
    );
  });

  it('ends the bout and names the winner when the cap is reached on exchanges alone', () => {
    // The control: three points, no penalty. Establishes that the fixture DOES
    // reach the cap, so the case below fails for the penalty and nothing else.
    wireSingle(matchRow({ phases: singleFightPhase() }), [ex(1, 'red', 3)]);
    return service.recomputeMatchScore('m1').then(() => {
      expect(lastUpdate?.['status']).toBe('completed');
      expect(lastUpdate?.['end_reason']).toBe('first_to_points');
      expect(lastUpdate?.['winner_registration_id']).toBe('red');
    });
  });

  it('a penalty that drops the cap-reacher below the cap un-ends the bout', async () => {
    // Red scores 3 into a cap of 3, then loses a point to a penalty. Before the
    // fix the decision was taken on the bare exchanges and said 'first_to_points'
    // while the winner was read from the penalised 2 and came back NULL — a
    // completed bout with a reason and nobody named.
    wireSingle(matchRow({ phases: singleFightPhase() }), [ex(1, 'red', 3)], [penalty('red', -1)]);

    const result = await service.recomputeMatchScore('m1');

    expect(result.redScore).toBe(2);
    expect(lastUpdate?.['status']).toBeUndefined();
    expect(lastUpdate?.['end_reason']).toBeUndefined();
    expect(lastUpdate?.['winner_registration_id']).toBeUndefined();
  });

  it('a penalty can also END a bout, by pushing the other fighter to the cap', async () => {
    // Blue is on 2 and red concedes a penalty point to blue, taking blue to 3.
    // The mirror of the case above: if the cap were still read off the bare
    // exchanges this would not end at all.
    wireSingle(matchRow({ phases: singleFightPhase() }), [ex(1, 'blue', 2)], [penalty('blue', 1)]);

    await service.recomputeMatchScore('m1');

    expect(lastUpdate?.['status']).toBe('completed');
    expect(lastUpdate?.['end_reason']).toBe('first_to_points');
    expect(lastUpdate?.['winner_registration_id']).toBe('blue');
  });

  it('reopens a completed bout when the penalty that ended it is voided', async () => {
    // A voided penalty simply stops being read, so the recompute that follows
    // sees a bout below the cap that is still marked completed. Both the write
    // and the void call this method, so the transition has to run both ways.
    wireSingle(
      matchRow({ status: 'completed', winner_registration_id: 'red', phases: singleFightPhase() }),
      [ex(1, 'red', 2)],
      [],
    );

    await service.recomputeMatchScore('m1');

    expect(matchCompletion.onMatchUncompleted).toHaveBeenCalledWith(
      'm1',
      expect.objectContaining({ discardDependents: false }),
    );
    // And the ROW moves. `onMatchUncompleted` owns only the side effects — its
    // other callers write the status themselves — so asserting the call alone
    // left the bout sitting at 'completed' with a winner it no longer has.
    expect(lastUpdate).toMatchObject({
      status: 'paused',
      winner_registration_id: null,
      end_reason: null,
      ended_at: null,
    });
  });

  /**
   * The doubles ceiling stops the bout under every outcome; what changes is the
   * RESULT. It is resolved into `end_reason` at completion so that later readers
   * — including a SQL function and the cross-event fighter stats, which cannot
   * reach the tournament's config — get the answer straight off the row.
   */
  it('names a winner when the ceiling is reached under result_stands', async () => {
    const poolPhase = (outcome: string) => ({
      type: 'pool',
      tournaments: {
        ruleset_config: {
          matchFormat: {
            pointCap: 10,
            maxDoubleHits: 2,
            maxDoubleHitOutcome: outcome,
            bestOf: { pool: 1, bracket: 1, finals: 1 },
          },
        },
        scoring_config_json: null,
      },
    });
    wireSingle(
      matchRow({ phases: poolPhase('result_stands'), match_number_label: 'P1M1' }),
      [ex(1, 'red', 2), dbl(2), dbl(3)],
      [],
    );

    await service.recomputeMatchScore('m1');

    expect(lastUpdate).toMatchObject({
      status: 'completed',
      end_reason: 'max_doubles_result_stands',
      winner_registration_id: 'red',
      // The board is NOT wiped — that is what `result_stands` means.
      red_score: 2,
    });
  });

  it('wipes the board and names nobody under the two zeroing outcomes', async () => {
    const poolPhase = (outcome: string) => ({
      type: 'pool',
      tournaments: {
        ruleset_config: {
          matchFormat: {
            pointCap: 10,
            maxDoubleHits: 2,
            maxDoubleHitOutcome: outcome,
            bestOf: { pool: 1, bracket: 1, finals: 1 },
          },
        },
        scoring_config_json: null,
      },
    });

    for (const [outcome, reason] of [
      ['double_loss_zero_scores', 'max_doubles'],
      ['draw_zero_scores', 'max_doubles_draw'],
    ]) {
      wireSingle(
        matchRow({ phases: poolPhase(outcome!), match_number_label: 'P1M1' }),
        [ex(1, 'red', 2), dbl(2), dbl(3)],
        [],
      );

      await service.recomputeMatchScore('m1');

      // Only 'max_doubles' means loss for both; the draw carries its own reason
      // so nothing that special-cases the double loss picks it up.
      expect(lastUpdate).toMatchObject({
        status: 'completed',
        end_reason: reason,
        winner_registration_id: null,
        red_score: 0,
        blue_score: 0,
      });
    }
  });

  it('does not reopen a bout that still meets its end condition', async () => {
    wireSingle(
      matchRow({ status: 'completed', winner_registration_id: 'red', phases: singleFightPhase() }),
      [ex(1, 'red', 3)],
      [],
    );

    await service.recomputeMatchScore('m1');

    expect(matchCompletion.onMatchUncompleted).not.toHaveBeenCalled();
  });

  it('survives a refused reopen without failing the penalty void', async () => {
    // onMatchUncompleted THROWS by design — a frozen result, an active forfeit,
    // a Swiss advance, or a dependent bout that has already been fought. The
    // void that triggered the recompute must still succeed.
    matchCompletion.onMatchUncompleted.mockRejectedValueOnce(new Error('result is frozen'));
    wireSingle(
      matchRow({ status: 'completed', winner_registration_id: 'red', phases: singleFightPhase() }),
      [ex(1, 'red', 2)],
      [],
    );

    await expect(service.recomputeMatchScore('m1')).resolves.toEqual({
      redScore: 2,
      blueScore: 0,
    });
  });
});
