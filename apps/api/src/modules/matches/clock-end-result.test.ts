import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ClockService } from './clock.service';
import { timeLimitResult } from './time-limit-result';

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

const RUNNING = [
  { id: 'e1', type: 'start', reason: null, occurred_at: '2026-04-25T09:00:00.000Z' },
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

  /**
   * `clockAction('end')` reads and writes in a fixed order, and the queue desyncs
   * if one is added or reordered:
   *   matches → match_events (replay) → match_events (next sequence)
   *   → match_events (insert) → matches (update) → match_events (replay again)
   */
  function wireEnd(match: Record<string, unknown>) {
    lastUpdate = null;
    matchProjection = '';
    const matchChain = thenable(match);
    (matchChain['select'] as ReturnType<typeof vi.fn>).mockImplementation((cols: string) => {
      matchProjection = cols;
      return matchChain;
    });
    const updateChain = thenable({ id: 'm1' });
    (updateChain['update'] as ReturnType<typeof vi.fn>).mockImplementation(
      (patch: Record<string, unknown>) => {
        lastUpdate = patch;
        return updateChain;
      },
    );
    fromMock
      .mockReturnValueOnce(matchChain)
      .mockReturnValueOnce(thenable(RUNNING))
      .mockReturnValueOnce(thenable({ sequence: 1 }))
      .mockReturnValueOnce(thenable(null))
      .mockReturnValueOnce(updateChain)
      .mockReturnValueOnce(thenable(RUNNING));
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

    for (const column of ['red_score', 'blue_score', 'red_registration_id', 'phases(']) {
      expect(matchProjection).toContain(column);
    }
  });
});

/**
 * The rule itself, without the six-read queue above. The phase dispatch is the
 * part the queue harness cannot reach cheaply, and it is the part that decides
 * whether the round route or this one owns the bout.
 */
describe('timeLimitResult', () => {
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
    expect(timeLimitResult(bout())).toMatchObject({
      winner_registration_id: 'red',
      end_reason: 'time_limit',
    });
  });

  it('follows the phase, not the label, for pool and swiss', () => {
    // Swiss falls back to the pool value when a config predates the format.
    expect(timeLimitResult(withBestOf('pool', { pool: 3, bracket: 1, finals: 1 }))).toEqual({});
    expect(timeLimitResult(withBestOf('swiss', { pool: 3, bracket: 1, finals: 1 }))).toEqual({});
    expect(timeLimitResult(withBestOf('pool', { pool: 1, bracket: 3, finals: 3 }))).toMatchObject({
      end_reason: 'time_limit',
    });
  });

  it('reads a medal match against bestOf.finals, not bestOf.bracket', () => {
    // `getEffectiveBestOf` dispatches medal labels to `finals`, so a bracket
    // that is single-round while the finals are best-of must not be confused
    // for one another here.
    const finalsAreBestOf = { pool: 1, bracket: 1, finals: 3 };
    expect(timeLimitResult(withBestOf('single_elim', finalsAreBestOf, 'F'))).toEqual({});
    expect(timeLimitResult(withBestOf('single_elim', finalsAreBestOf, 'QF1'))).toMatchObject({
      end_reason: 'time_limit',
    });
  });

  it('tolerates the embed arriving as a one-element array', () => {
    // PostgREST returns an embedded row either way depending on the join.
    expect(
      timeLimitResult(bout({ phases: [{ type: 'pool', tournaments: [{ ruleset_config: {} }] }] })),
    ).toMatchObject({ winner_registration_id: 'red' });
  });
});
