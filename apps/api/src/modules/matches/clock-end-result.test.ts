import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ClockService } from './clock.service';
import { extraTimeAdjustmentMs, timeLimitResult } from './time-limit-result';

/**
 * What the `end` clock action RECORDS.
 *
 * `clock.service.test.ts` covers only the pure `computeClockState`, built with
 * `new ClockService(null as never)` — so `clockAction` itself, the method that
 * decides what a finished bout says, had no supabase-driven test at all. Its own
 * file rather than that one, because this needs the whole ordered mock queue and
 * that file needs none of it.
 *
 * A bout that ran out of time used to complete with no winner and no end reason,
 * even at 3-1, and eleven surfaces downstream each guessed what that meant.
 */

/** Both thenable (a terminal `.eq()`/`.order()` awaits) and `.maybeSingle()`-able. */
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

/**
 * A halted clock with 90s of active time — the default phase limit, spent.
 *
 * IT MUST BE HALT-TERMINATED. An un-closed `start` replays as still running, so
 * `computeClockState` bills it against the real `Date.now()` and every case
 * below would satisfy the time guard by the calendar rather than by what it
 * says. `end` is legal from `halted` just as it is from `running`.
 */
const SPENT = [
  { id: 'e1', type: 'start', reason: null, occurred_at: '2026-04-25T09:00:00.000Z' },
  { id: 'e2', type: 'halt', reason: null, occurred_at: '2026-04-25T09:01:30.000Z' },
];

/** The same bout 30s in: a minute of the phase's 90s still to fight. */
const EARLY = [
  { id: 'e1', type: 'start', reason: null, occurred_at: '2026-04-25T09:00:00.000Z' },
  { id: 'e2', type: 'halt', reason: null, occurred_at: '2026-04-25T09:00:30.000Z' },
];

function matchRow(over: Record<string, unknown> = {}) {
  return {
    id: 'm1',
    status: 'running',
    locked_at: null,
    started_at: '2026-04-25T09:00:00.000Z',
    rounds_json: null,
    current_round: 1,
    red_registration_id: 'red',
    blue_registration_id: 'blue',
    red_score: 3,
    blue_score: 1,
    match_number_label: 'P1M1',
    phases: {
      type: 'pool',
      tournaments: {
        ruleset_config: { matchFormat: { bestOf: { pool: 1, bracket: 1, finals: 1 } } },
      },
    },
    ...over,
  };
}

describe('ClockService — what ending the clock records', () => {
  const fromMock = vi.fn();
  const supabase = { service: { from: fromMock } };
  let service: ClockService;
  let lastUpdate: Record<string, unknown> | null;
  let matchProjection: string;
  let eventTypesRead: string[];

  /**
   * `clockAction('end')` reads and writes in a fixed order, and the queue desyncs
   * if one is added or reordered:
   *   matches → match_events (replay) → match_events (next sequence)
   *   → match_events (insert) → matches (update) → match_events (replay again)
   */
  function wireEnd(match: Record<string, unknown>, events: unknown[] = SPENT) {
    // A REFUSED end consumes only the first two of the six, so the leftovers
    // would answer the next call's reads. Reset the queue rather than append.
    fromMock.mockReset();
    lastUpdate = null;
    matchProjection = '';
    eventTypesRead = [];
    const matchChain = thenable(match);
    (matchChain['select'] as ReturnType<typeof vi.fn>).mockImplementation((cols: string) => {
      matchProjection = cols;
      return matchChain;
    });
    const replay = () => {
      const chain = thenable(events);
      (chain['in'] as ReturnType<typeof vi.fn>).mockImplementation(
        (_col: string, types: string[]) => {
          eventTypesRead = types;
          return chain;
        },
      );
      return chain;
    };
    const updateChain = thenable({ id: 'm1' });
    (updateChain['update'] as ReturnType<typeof vi.fn>).mockImplementation(
      (patch: Record<string, unknown>) => {
        lastUpdate = patch;
        return updateChain;
      },
    );
    fromMock
      .mockReturnValueOnce(matchChain)
      .mockReturnValueOnce(replay())
      .mockReturnValueOnce(thenable({ sequence: 1 }))
      .mockReturnValueOnce(thenable(null))
      .mockReturnValueOnce(updateChain)
      .mockReturnValueOnce(replay());
  }

  /** The remedy a refused `end` named, from its problem body. */
  async function refusalOf(match: Record<string, unknown>, events: unknown[] = SPENT) {
    wireEnd(match, events);
    try {
      await service.clockAction('m1', 'end');
    } catch (err) {
      return (err as { getResponse(): Record<string, unknown> }).getResponse();
    }
    throw new Error('expected the end to be refused');
  }

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ClockService(supabase as never);
  });

  it('names the leader and the reason when a bout runs out of time', async () => {
    wireEnd(matchRow());

    await service.clockAction('m1', 'end');

    expect(lastUpdate).toMatchObject({
      status: 'completed',
      winner_registration_id: 'red',
      end_reason: 'time_limit',
    });
  });

  it('names the blue fighter when blue is the one ahead', async () => {
    // The mirror, so the case above cannot pass on a hardcoded side.
    wireEnd(matchRow({ red_score: 1, blue_score: 4 }));

    await service.clockAction('m1', 'end');

    expect(lastUpdate).toMatchObject({ winner_registration_id: 'blue', end_reason: 'time_limit' });
  });

  it('names nobody when the bout is LEVEL at time', async () => {
    // A genuine draw, which is what a pool table's D column is for. After this
    // change a null winner on a completed bout means exactly that and nothing
    // else — which is why every reader downstream can be left alone.
    wireEnd(matchRow({ red_score: 2, blue_score: 2 }));

    await service.clockAction('m1', 'end');

    expect(lastUpdate).toMatchObject({ status: 'completed' });
    expect(lastUpdate?.['winner_registration_id']).toBeUndefined();
    expect(lastUpdate?.['end_reason']).toBeUndefined();
  });

  it('names nobody on a BEST-OF match, whose rounds are owned elsewhere', async () => {
    // `ScoringService.endRoundOnTime` closes a ROUND, not the series, and
    // refuses a tied one so the operator plays a sudden-death point. The pad
    // routes there and never reaches this branch — the guard is defensive.
    wireEnd(
      matchRow({
        phases: {
          type: 'single_elim',
          tournaments: {
            ruleset_config: { matchFormat: { bestOf: { pool: 1, bracket: 3, finals: 3 } } },
          },
        },
        match_number_label: 'QF1',
      }),
    );

    await service.clockAction('m1', 'end');

    expect(lastUpdate?.['winner_registration_id']).toBeUndefined();
    expect(lastUpdate?.['end_reason']).toBeUndefined();
  });

  it('asks for the columns it decides on', async () => {
    // The chain is canned and answers with these whether or not the query asked,
    // so every assertion above passes with the columns deleted from the select
    // while PostgREST would return none of them. Nothing else watches the string.
    wireEnd(matchRow());

    await service.clockAction('m1', 'end');

    for (const column of [
      'red_score',
      'blue_score',
      'red_registration_id',
      // The decided test is the LADDER, not the scores — a forfeit names the
      // winner on a row a zeroing score policy left 0-0.
      'winner_registration_id',
      'phases(',
    ]) {
      expect(matchProjection).toContain(column);
    }
  });

  it('asks the timeline for the level-resolution steps', async () => {
    // A SEPARATE capture from the select above: the event replay filters on
    // `.in('type', [...])` and the mock chain returns itself whatever it is
    // handed, so every chain assertion below passes with the type deleted from
    // that list while the real read would never see one.
    wireEnd(matchRow());

    await service.clockAction('m1', 'end');

    expect(eventTypesRead).toContain('level_resolution');
    expect(eventTypesRead).toContain('reset_match');
  });

  // ── The level-at-time chain ───────────────────────────────────────────────

  /** A level bracket bout — the case a draw cannot settle, because it cannot advance. */
  const levelBracket = (over: Record<string, unknown> = {}) =>
    matchRow({
      red_score: 2,
      blue_score: 2,
      match_number_label: 'QF1',
      phases: { type: 'single_elim', tournaments: { ruleset_config: {} } },
      ...over,
    });

  /** `n` steps already taken, as the timeline rows the clock replays. */
  const withSteps = (n: number) => [
    ...SPENT,
    ...Array.from({ length: n }, (_, i) => ({
      id: `lr${i}`,
      type: 'level_resolution',
      reason: null,
      occurred_at: '2026-04-25T09:01:00.000Z',
    })),
  ];

  it('refuses a level bracket bout and names the extra time it is waiting on', async () => {
    // Default bracket chain: a minute of extra time, then sudden death. Today
    // this completed as a draw, and a drawn elimination bout cannot advance —
    // the round stalled with nothing to show for it.
    expect(await refusalOf(levelBracket())).toMatchObject({
      code: 'level_at_time_unresolved',
      remedy: 'extra_time',
      seconds: 60,
    });
    expect(lastUpdate).toBeNull();
  });

  it('refuses with SUDDEN DEATH once the extra time has been played', async () => {
    expect(await refusalOf(levelBracket(), withSteps(1))).toMatchObject({
      code: 'level_at_time_unresolved',
      remedy: 'sudden_death',
    });
    expect((await refusalOf(levelBracket(), withSteps(1)))['seconds']).toBeUndefined();
  });

  it('refuses with the chain spent once sudden death is live', async () => {
    // Nothing left to advance to, and that is not a dead end: the bout ends when
    // one fighter LEADS. Not on the next point — an afterblow can score both.
    const body = await refusalOf(levelBracket(), withSteps(2));
    expect(body).toMatchObject({ remedy: 'sudden_death' });
    expect(String(body['message'])).toMatch(/leads/);
  });

  it('still completes a level POOL bout as a draw', async () => {
    // The default pool chain is a single `draw` step, so nothing changes here —
    // a drawn pool bout is a real result and the standings have a D column.
    wireEnd(matchRow({ red_score: 2, blue_score: 2 }));

    await service.clockAction('m1', 'end');

    expect(lastUpdate).toMatchObject({ status: 'completed' });
    expect(lastUpdate?.['winner_registration_id']).toBeUndefined();
  });

  // ── The time guard, in front of the chain ─────────────────────────────────

  it('refuses a level bout that still has time, WITHOUT naming a remedy', async () => {
    // The two refusals are both 400s and must not be confused: this one says
    // keep fighting, the chain's says the time is up and here is what to play.
    const body = await refusalOf(levelBracket(), EARLY);

    expect(body).toMatchObject({ code: 'time_not_finished' });
    expect(body['remedy']).toBeUndefined();
    expect(lastUpdate).toBeNull();
  });

  it('refuses a level POOL bout early too — the guard is every phase', async () => {
    // A pool chain is a single `draw`, so this bout WILL complete as a draw when
    // its time is up. It still may not be stopped level before then.
    expect(await refusalOf(matchRow({ red_score: 2, blue_score: 2 }), EARLY)).toMatchObject({
      code: 'time_not_finished',
    });
  });

  it('does not hold an already-completed level bout', async () => {
    // A forfeit or a ceiling end stops its clock after the fact, from inside a
    // bare `catch`. A refusal there would leave the clock running forever and
    // the endcard unfired, so the completed check stays AHEAD of the guard.
    wireEnd(levelBracket({ status: 'completed' }), EARLY);

    await service.clockAction('m1', 'end');

    expect(lastUpdate).toMatchObject({ status: 'completed' });
  });

  it('ends a level bracket bout that already carries a forfeit winner', async () => {
    // A forfeit writes the winner and THEN stops the clock, and under a zeroing
    // score policy that row is 0-0. Reading the scores alone would call it level
    // and refuse — inside a `catch` that swallows the refusal, so the clock
    // would simply never stop and the endcard would never fire.
    wireEnd(levelBracket({ red_score: 0, blue_score: 0, winner_registration_id: 'blue' }));

    await service.clockAction('m1', 'end');

    expect(lastUpdate).toMatchObject({
      status: 'completed',
      winner_registration_id: 'blue',
      end_reason: 'time_limit',
    });
  });
});

/**
 * The rule itself, without the six-read queue above. The phase dispatch is the
 * part the queue harness cannot reach cheaply, and it is the part that decides
 * whether the round route or this one owns the bout.
 */
describe('timeLimitResult', () => {
  /**
   * Every case below ends a bout with the clock barely started, and passes
   * BECAUSE the branch it exercises sits ahead of the time guard: a best-of
   * match is the round route's, and a bout with a leader is decided whenever the
   * referee stops it. Only a LEVEL bout has to wait for its time.
   */
  const ELAPSED_ZERO = 0;

  const bout = (over: Record<string, unknown> = {}) => ({
    red_registration_id: 'red',
    blue_registration_id: 'blue',
    red_score: 3,
    blue_score: 1,
    match_number_label: 'P1M1',
    phases: { type: 'pool', tournaments: { ruleset_config: {} } },
    ...over,
  });

  const withBestOf = (type: string, bestOf: Record<string, number>, label = 'P1M1') =>
    bout({
      match_number_label: label,
      phases: { type, tournaments: { ruleset_config: { matchFormat: { bestOf } } } },
    });

  it('names the leader when no match format is configured at all', () => {
    // `normalizeMatchFormatConfig({})` defaults bestOf to 1, so an older
    // tournament with no matchFormat block still resolves rather than falling
    // into the best-of branch and silently naming nobody.
    expect(timeLimitResult(bout(), 0, ELAPSED_ZERO)).toEqual({
      complete: { winner_registration_id: 'red', end_reason: 'time_limit' },
    });
  });

  it('follows the phase, not the label, for pool and swiss', () => {
    // Swiss falls back to the pool value when a config predates the format.
    expect(
      timeLimitResult(withBestOf('pool', { pool: 3, bracket: 1, finals: 1 }), 0, ELAPSED_ZERO),
    ).toEqual({
      complete: {},
    });
    expect(
      timeLimitResult(withBestOf('swiss', { pool: 3, bracket: 1, finals: 1 }), 0, ELAPSED_ZERO),
    ).toEqual({
      complete: {},
    });
    expect(
      timeLimitResult(withBestOf('pool', { pool: 1, bracket: 3, finals: 3 }), 0, ELAPSED_ZERO),
    ).toMatchObject({ complete: { end_reason: 'time_limit' } });
  });

  it('reads a medal match against bestOf.finals, not bestOf.bracket', () => {
    // `getEffectiveBestOf` dispatches medal labels to `finals`, so a bracket
    // that is single-round while the finals are best-of must not be confused
    // for one another here.
    const finalsAreBestOf = { pool: 1, bracket: 1, finals: 3 };
    expect(
      timeLimitResult(withBestOf('single_elim', finalsAreBestOf, 'F'), 0, ELAPSED_ZERO),
    ).toEqual({
      complete: {},
    });
    expect(
      timeLimitResult(withBestOf('single_elim', finalsAreBestOf, 'QF1'), 0, ELAPSED_ZERO),
    ).toMatchObject({
      complete: { end_reason: 'time_limit' },
    });
  });

  it('refuses a LEVEL bout that still has time to run', () => {
    // 30s into the default 90s. Ahead of the chain on purpose: the remedies are
    // what the referee plays once the time is up, and a chain reachable before
    // then is advice rather than a rule.
    expect(timeLimitResult(bout({ red_score: 2, blue_score: 2 }), 0, 30_000)).toEqual({
      refuse: { reason: 'time_not_finished' },
    });
  });

  it('refuses on the phase limit the bout actually counts against', () => {
    // A bracket bout billed at the pool clock would stop 60s early. The limit is
    // dispatched by phase exactly as the best-of above it is.
    const level = { red_score: 2, blue_score: 2 };
    const perPhase = { pool: 30, bracket: 120, finals: 120 };
    const asPool = bout({
      ...level,
      phases: {
        type: 'pool',
        tournaments: { ruleset_config: { matchFormat: { timeLimitsSeconds: perPhase } } },
      },
    });
    const asBracket = bout({
      ...level,
      match_number_label: 'QF1',
      phases: {
        type: 'single_elim',
        tournaments: { ruleset_config: { matchFormat: { timeLimitsSeconds: perPhase } } },
      },
    });

    expect(timeLimitResult(asPool, 0, 60_000)).toEqual({ complete: {} });
    expect(timeLimitResult(asBracket, 0, 60_000)).toEqual({
      refuse: { reason: 'time_not_finished' },
    });
  });

  it('lets a level bout complete when the phase has NO time limit', () => {
    // The branch the guard would otherwise make unreachable. Null means there is
    // no time to wait for, so the chain decides at once — a pool `draw` here.
    const noLimit = bout({
      red_score: 2,
      blue_score: 2,
      phases: {
        type: 'pool',
        tournaments: {
          ruleset_config: { matchFormat: { timeLimitsSeconds: { pool: null } } },
        },
      },
    });

    expect(timeLimitResult(noLimit, 0, 0)).toEqual({ complete: {} });
  });

  it('does not hold a bout that has a LEADER', () => {
    // The guard is for level bouts only. Stopping a 3-1 bout early is the
    // referee's call and always was; what it stores is a separate question.
    expect(timeLimitResult(bout(), 0, 1_000)).toMatchObject({
      complete: { winner_registration_id: 'red' },
    });
  });

  it('tolerates the embed arriving as a one-element array', () => {
    // PostgREST returns an embedded row either way depending on the join.
    expect(
      timeLimitResult(
        bout({ phases: [{ type: 'pool', tournaments: [{ ruleset_config: {} }] }] }),
        0,
        ELAPSED_ZERO,
      ),
    ).toMatchObject({ complete: { winner_registration_id: 'red' } });
  });
});

/**
 * How far down the chain a bout has been taken, replayed from its timeline.
 *
 * It rides on the clock's own read and must not reach the clock: the rows are
 * counted out of the list before `computeClockState` replays it, so neither the
 * `ClockAction` union nor the pad's unified timeline widens for them.
 */
describe('computeClockState — level resolution steps', () => {
  const service = new ClockService(null as never);
  const row = (id: string, type: string, occurred = '2026-04-25T09:00:00.000Z') => ({
    id,
    type,
    reason: null,
    occurred_at: occurred,
  });

  it('counts the steps and keeps them out of the clock', () => {
    const state = service.computeClockState('m1', [
      row('e1', 'start'),
      row('lr1', 'level_resolution'),
      row('e2', 'halt', '2026-04-25T09:01:00.000Z'),
      row('lr2', 'level_resolution'),
    ]);

    expect(state.levelResolutionSteps).toBe(2);
    // Neither the totals nor the timeline may notice them.
    expect(state.events.map((e) => e.type)).toEqual(['start', 'halt']);
    expect(state.status).toBe('halted');
    expect(state.activeMs).toBe(60_000);
  });

  it('starts the chain over on a reset_match', () => {
    // A reset puts the bout back to unplayed, so the remedies it had already
    // played are gone too — the same semantics the clock gets for free.
    const state = service.computeClockState('m1', [
      row('lr1', 'level_resolution'),
      row('lr2', 'level_resolution'),
      row('r1', 'reset_match'),
      row('lr3', 'level_resolution'),
    ]);

    expect(state.levelResolutionSteps).toBe(1);
  });
});

/**
 * Putting extra time back on a countdown.
 *
 * THE SIGN IS THE TRAP: `adjust_time` mutates ELAPSED and a countdown shows
 * `limit − elapsed`, so granting time is a NEGATIVE adjustment.
 */
describe('extraTimeAdjustmentMs', () => {
  it('lands the clock on exactly the seconds granted', () => {
    // 90s limit, 90s elapsed — the bout is at 00:00. A minute of extra time
    // means 60s remaining, i.e. 30s elapsed: an adjustment of −60s.
    expect(extraTimeAdjustmentMs(60, 90_000, 90_000)).toBe(-60_000);
  });

  it('absorbs a clock that ran PAST zero', () => {
    // Elapsed carries a hidden overshoot while the display sits pinned at 00:00,
    // so a flat −60s would give a referee rather less than a minute. Anchoring
    // on the display is what makes the granted time the time actually granted.
    expect(extraTimeAdjustmentMs(60, 150_000, 90_000)).toBe(-120_000);
  });

  it('does nothing when there is no limit to extend', () => {
    // Count-up, or a phase configured with no time limit: extra time is an
    // instruction to the referee, not a clock mutation. Rewinding the numeral
    // would be a lie about how long the bout has run.
    expect(extraTimeAdjustmentMs(60, 90_000, null)).toBe(0);
  });
});
