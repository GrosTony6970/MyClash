import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ScoringService } from './scoring.service';
import { builtInResolver } from './built-in-resolver.fixtures';

/**
 * Ending a ROUND of a best-of match on the clock.
 *
 * A round is a bout, so a level one follows the phase's chain exactly as a
 * single bout does. It used to throw a bare string — "Round is tied — play a
 * sudden-death point to decide it" — with no `code`, so `refusal-copy.ts` fell
 * through to `failure.detail` and put that English on a French referee's
 * tablet. Worse, it named a remedy the organiser had never chosen: a pool
 * best-of could not draw a round however its chain read, and the pad showed no
 * button, no skull and no count-up to play sudden death with.
 *
 * Its own file: the read queue here is `loadRoundContext`'s
 * (matches → exchanges → match_penalties) plus a clock read, which is neither
 * the recompute queue in `scoring.service.test.ts` nor the clock's own.
 */
function thenable(data: unknown) {
  const result = { data, error: null };
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'in', 'order', 'limit', 'insert', 'update']) {
    chain[m] = vi.fn(() => chain);
  }
  chain['maybeSingle'] = vi.fn().mockResolvedValue(result);
  (chain as { then?: unknown })['then'] = (resolve: (v: unknown) => unknown) => resolve(result);
  return chain;
}

/** A best-of-3 of 90s rounds, first to 10. */
const format = (over: Record<string, unknown> = {}) => ({
  pointCap: 10,
  timeLimitsSeconds: { pool: 90, bracket: 90, finals: 90 },
  bestOf: { pool: 3, bracket: 3, finals: 3 },
  ...over,
});

/** The bout's copy of its rules (0229): what the round's end decides with, its engine included. */
const rules = (over: Record<string, unknown> = {}) => ({
  ruleset_code: 'TF_v1',
  ruleset_version: '1.0.0',
  ruleset_config: { matchFormat: format(over) },
  scoring_config_json: {},
});

function matchRow(over: Record<string, unknown> = {}) {
  return {
    id: 'm1',
    red_registration_id: 'red',
    blue_registration_id: 'blue',
    status: 'running',
    winner_registration_id: null,
    match_number_label: 'QF1',
    current_round: 1,
    rounds_json: null,
    red_round_wins: 0,
    blue_round_wins: 0,
    awaiting_round_advance: false,
    phases: { type: 'single_elim' },
    match_rules: rules(),
    ...over,
  };
}

const hit = (seq: number, color: 'red' | 'blue', value: number, round = 1) => ({
  id: `e${seq}`,
  client_uuid: `u${seq}`,
  match_id: 'm1',
  sequence: seq,
  type: 'clean',
  occurred_at: '2026-04-25T09:00:00.000Z',
  first_striker_color: color,
  first_strike_value: value,
  afterblow_value: null,
  no_exchange_reason: null,
  round_number: round,
  voided: false,
});

/** The refusal body Nest carries on a BadRequestException. */
async function refusalOf(run: () => Promise<unknown>): Promise<Record<string, unknown>> {
  try {
    await run();
  } catch (err) {
    return (err as { getResponse(): Record<string, unknown> }).getResponse();
  }
  throw new Error('expected a refusal, and the round was closed instead');
}

describe('ScoringService.endRoundOnTime', () => {
  const fromMock = vi.fn();
  const supabase = { service: { from: fromMock } };
  const rulesets = builtInResolver();
  /** 90s of the phase's 90s limit spent — the round is at 00:00. */
  const clock = {
    getClockState: vi.fn(),
    clockAction: vi.fn().mockResolvedValue(undefined),
  };
  let service: ScoringService;
  let lastUpdate: Record<string, unknown> | null;

  // loadRoundContext: matches → exchanges → match_penalties, then the update.
  function wire(match: Record<string, unknown>, exchanges: unknown[]) {
    lastUpdate = null;
    const updateChain = thenable({ id: 'm1' });
    (updateChain['update'] as ReturnType<typeof vi.fn>).mockImplementation(
      (patch: Record<string, unknown>) => {
        lastUpdate = patch;
        return updateChain;
      },
    );
    fromMock.mockReset();
    fromMock
      .mockReturnValueOnce(thenable(match))
      .mockReturnValueOnce(thenable(exchanges))
      .mockReturnValueOnce(thenable([]))
      .mockReturnValue(updateChain);
  }

  const atClock = (totalActiveMs: number, levelResolutionSteps = 0) =>
    clock.getClockState.mockResolvedValue({
      status: 'halted',
      totalActiveMs,
      levelResolutionSteps,
      activeMs: totalActiveMs,
    });

  beforeEach(() => {
    vi.clearAllMocks();
    atClock(90_000);
    service = new ScoringService(supabase as never, rulesets, clock as never);
  });

  it('awards a round with a leader to whoever leads', async () => {
    wire(matchRow(), [hit(1, 'blue', 2), hit(2, 'red', 1)]);

    await service.endRoundOnTime('m1');

    expect(lastUpdate).toMatchObject({ blue_round_wins: 1, red_round_wins: 0 });
    const rounds = lastUpdate?.['rounds_json'] as Array<Record<string, unknown>>;
    expect(rounds[0]).toMatchObject({ winnerColor: 'blue', endReason: 'time_limit' });
  });

  it('refuses a level round with the phase`s FIRST remedy, and a code', async () => {
    // The pad maps `level_at_time_unresolved` to its own localised copy. A bare
    // string here is what put the server's English on a referee's tablet.
    wire(matchRow(), [hit(1, 'red', 2), hit(2, 'blue', 2)]);

    const body = await refusalOf(() => service.endRoundOnTime('m1'));

    expect(body).toMatchObject({
      code: 'level_at_time_unresolved',
      remedy: 'extra_time',
      seconds: 60,
    });
    expect(lastUpdate).toBeNull();
  });

  it('names sudden death once the extra time has been played', async () => {
    // One `level_resolution` recorded, so the chain has moved on a step. The
    // count is round-scoped: `advanceRound` resets it.
    atClock(90_000, 1);
    wire(matchRow(), [hit(1, 'red', 2), hit(2, 'blue', 2)]);

    const body = await refusalOf(() => service.endRoundOnTime('m1'));

    expect(body).toMatchObject({ code: 'level_at_time_unresolved', remedy: 'sudden_death' });
  });

  it('refuses a level round that still has time to run, and says so DIFFERENTLY', async () => {
    // Two different instructions: this one says keep fighting. One code for
    // both would tell a referee to play sudden death with a minute still on
    // the clock.
    atClock(30_000);
    wire(matchRow(), [hit(1, 'red', 2), hit(2, 'blue', 2)]);

    const body = await refusalOf(() => service.endRoundOnTime('m1'));

    expect(body['code']).toBe('time_not_finished');
  });

  it('DRAWS a level round where the phase chain says draw', async () => {
    // A pool best-of. The drawn round is a real result — and the only way a
    // series can reach the end of its rounds without a winner.
    wire(matchRow({ match_number_label: 'L1-P1-M01', phases: { type: 'pool' } }), [
      hit(1, 'red', 2),
      hit(2, 'blue', 2),
    ]);

    await service.endRoundOnTime('m1');

    const rounds = lastUpdate?.['rounds_json'] as Array<Record<string, unknown>>;
    expect(rounds[0]).toMatchObject({ winnerColor: null, endReason: 'time_limit' });
    expect(lastUpdate).toMatchObject({ red_round_wins: 0, blue_round_wins: 0 });
    // Two rounds still owed, so the series is not over.
    expect(lastUpdate?.['status']).toBeUndefined();
  });

  it('completes a series whose LAST round is drawn on the clock', async () => {
    // Pool BO3, one round each, and the decider is level at the limit. The
    // rounds are spent, so the series ends level rather than opening a fourth.
    wire(
      matchRow({
        match_number_label: 'L1-P1-M01',
        phases: { type: 'pool' },
        current_round: 3,
        rounds_json: [
          {
            round: 1,
            redScore: 10,
            blueScore: 4,
            winnerColor: 'red',
            endReason: 'first_to_points',
          },
          {
            round: 2,
            redScore: 3,
            blueScore: 10,
            winnerColor: 'blue',
            endReason: 'first_to_points',
          },
        ],
      }),
      [hit(1, 'red', 2, 3), hit(2, 'blue', 2, 3)],
    );

    await service.endRoundOnTime('m1');

    expect(lastUpdate).toMatchObject({
      status: 'completed',
      winner_registration_id: null,
      end_reason: 'rounds_spent',
      awaiting_round_advance: false,
    });
  });

  it('refuses a single-round match, and an already-ended round', async () => {
    wire(matchRow({ match_rules: rules({ bestOf: { pool: 1, bracket: 1, finals: 1 } }) }), []);
    await expect(service.endRoundOnTime('m1')).rejects.toThrow(/Not a best-of match/);

    wire(matchRow({ awaiting_round_advance: true }), []);
    await expect(service.endRoundOnTime('m1')).rejects.toThrow(/advance to the next round/);
  });

  it('a level round gets the extra time its bout started under, though its Tournament now says sudden death', async () => {
    // The bout started with 30s of extra time for a level round. The organiser has since set the
    // Tournament to sudden death. The bout keeps the rules it started under (ruling, 2026-10-17).
    const startedUnder = {
      bracket: [{ kind: 'extra_time', seconds: 30 }, { kind: 'sudden_death' }],
    };
    const tournamentNow = {
      ruleset_config: {
        matchFormat: format({ levelAtTime: { bracket: [{ kind: 'sudden_death' }] } }),
      },
    };
    wire(
      matchRow({
        phases: { type: 'single_elim', tournaments: tournamentNow },
        match_rules: rules({ levelAtTime: startedUnder }),
      }),
      [hit(1, 'red', 2), hit(2, 'blue', 2)],
    );

    const body = await refusalOf(() => service.endRoundOnTime('m1'));

    expect(body).toMatchObject({
      code: 'level_at_time_unresolved',
      remedy: 'extra_time',
      seconds: 30,
    });
    // The double hands back every column it holds: the read must ASK for the copy.
    const read = fromMock.mock.results[0]?.value as { select: ReturnType<typeof vi.fn> };
    expect(read.select.mock.calls[0]?.[0]).toContain(
      'match_rules(ruleset_code, ruleset_version, ruleset_config, scoring_config_json)',
    );
  });
});
