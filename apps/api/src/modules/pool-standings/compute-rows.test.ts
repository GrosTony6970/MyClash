/**
 * computeStandingsRows is the assembly above applyRanking: it turns a member
 * list and its completed bouts into ranked standings rows. Pool standings decide
 * who promotes to the bracket, so every column it fills is load-bearing.
 *
 * It was executed by pool-standings.service.test.ts on nearly every line and
 * asserted by none of them — a Supabase-mocked service test runs this code but
 * holds the service's contract, not this one. applyRanking has its own test in
 * standings-rows.test.ts; the gap was everything that builds the rows handed to
 * it.
 *
 * `computeAggregates` is deliberately REAL here, imported from @myclash/rulesets.
 * Mocking it would make the afterblow mode unobservable, and the afterblow mode
 * is the one input whose default silently changes every hit count. `ruleset` is
 * a parameter rather than a registry lookup, so a stub is honest — contrast
 * Swiss, where the built-in rulesets register only as an import side effect.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Exchange, Ruleset, StandingsColumn } from '@myclash/rulesets';
import { computeStandingsRows, type ComputeRowsInput, type StandingsMember } from './compute-rows';

const A = 'reg-a';
const B = 'reg-b';
const C = 'reg-c';

type Rows = ReturnType<typeof computeStandingsRows>;

const statsOf = (rows: Rows, id: string) => rows.find((r) => r.registrationId === id)!.stats;

function member(registrationId: string, givenName: string): StandingsMember {
  return {
    registration_id: registrationId,
    registrations: {
      id: `row-${registrationId}`,
      persons: {
        id: `person-${registrationId}`,
        given_name: givenName,
        family_name: 'Fighter',
        clubs: null,
      },
    },
  };
}

function col(key: string): StandingsColumn {
  return { key, label: key, type: 'number' };
}

function bout(
  id: string,
  red: string,
  redScore: number | null,
  blue: string,
  blueScore: number | null,
  winner: string | null = null,
  endReason: string | null = null,
) {
  return {
    id,
    red_registration_id: red,
    blue_registration_id: blue,
    red_score: redScore,
    blue_score: blueScore,
    winner_registration_id: winner,
    end_reason: endReason,
  };
}

function exchange(over: Partial<Exchange>): Exchange {
  return {
    id: 'x-1',
    clientUuid: 'x-1',
    matchId: 'm-1',
    sequence: 1,
    type: 'clean',
    occurredAt: '2026-08-19T10:00:00.000Z',
    firstStrikerColor: 'red',
    firstStrikeValue: 1,
    afterblowValue: null,
    noExchangeReason: null,
    voided: false,
    ...over,
  };
}

/**
 * A stub ruleset. Returned alongside its spy so "was the ruleset consulted at
 * all?" is directly assertable — that, not a value, is what separates a declared
 * score column from an absent one.
 */
function stubRuleset(scores: Record<string, number> = {}) {
  const scorePoolFighters = vi.fn(
    ({ registrationIds }: { registrationIds: string[] }) =>
      new Map(registrationIds.map((id) => [id, scores[id] ?? 0])),
  );
  const ruleset = {
    code: 'Stub',
    version: '1.0.0',
    displayName: 'Stub ruleset',
    scorePoolFighters,
  } as unknown as Ruleset;
  return { ruleset, scorePoolFighters };
}

function input(over: Partial<ComputeRowsInput> = {}): ComputeRowsInput {
  return {
    members: [member(A, 'Ada'), member(B, 'Bo')],
    completedMatches: [],
    columns: [col('W'), col('L'), col('D')],
    rankingChain: [{ key: 'W', direction: 'desc' }],
    status: 'completed',
    exchangesByMatch: new Map(),
    forfeitCountByReg: new Map(),
    drawnForfeitMatchIds: new Set(),
    ruleset: stubRuleset().ruleset,
    runtimeConfig: {},
    afterblowMode: 'full',
    ...over,
  };
}

describe('computeStandingsRows — win, loss and draw', () => {
  it('reads the win and the loss off the scores', () => {
    const rows = computeStandingsRows(input({ completedMatches: [bout('m-1', A, 5, B, 3, A)] }));

    expect(statsOf(rows, A)).toMatchObject({ W: 1, L: 0, D: 0 });
    expect(statsOf(rows, B)).toMatchObject({ W: 0, L: 1, D: 0 });
  });

  it('records a draw for both fighters when the scores are equal', () => {
    const rows = computeStandingsRows(input({ completedMatches: [bout('m-1', A, 4, B, 4)] }));

    expect(statsOf(rows, A)).toMatchObject({ W: 0, L: 0, D: 1 });
    expect(statsOf(rows, B)).toMatchObject({ W: 0, L: 0, D: 1 });
  });

  it('treats an unrecorded score as zero, which makes an empty bout a draw', () => {
    const rows = computeStandingsRows(input({ completedMatches: [bout('m-1', A, null, B, null)] }));

    expect(statsOf(rows, A)).toMatchObject({ D: 1, ptsScored: 0, ptsConceded: 0 });
  });

  /**
   * A bout stopped by the doubles ceiling under `double_loss_zero_scores` is a
   * LOSS FOR BOTH. It is 0-0, so the scores alone cannot say so — it used to
   * fall to the final `else` and score as a draw, while Swiss read the same
   * bout as a double loss from the same column.
   */
  it('records a LOSS for both when the bout ended on the doubles ceiling', () => {
    const rows = computeStandingsRows(
      input({ completedMatches: [bout('m-md', A, 0, B, 0, null, 'max_doubles')] }),
    );

    expect(statsOf(rows, A)).toMatchObject({ W: 0, L: 1, D: 0 });
    expect(statsOf(rows, B)).toMatchObject({ W: 0, L: 1, D: 0 });
  });

  it('leaves the other two ceiling reasons to the scores, which already say it', () => {
    // 'max_doubles_draw' IS a 0-0 draw and 'max_doubles_result_stands' keeps a
    // real score, so neither needs a branch — that is why the outcome is
    // resolved into the reason instead of read back from the config here.
    const drawn = computeStandingsRows(
      input({ completedMatches: [bout('m-d', A, 0, B, 0, null, 'max_doubles_draw')] }),
    );
    expect(statsOf(drawn, A)).toMatchObject({ W: 0, L: 0, D: 1 });

    const stands = computeStandingsRows(
      input({
        completedMatches: [bout('m-s', A, 2, B, 0, A, 'max_doubles_result_stands')],
      }),
    );
    expect(statsOf(stands, A)).toMatchObject({ W: 1, L: 0, D: 0 });
    expect(statsOf(stands, B)).toMatchObject({ W: 0, L: 1, D: 0 });
  });

  it('lets an explicit forfeit draw outrank the ceiling', () => {
    // Ordering, made visible: `drawnForfeitMatchIds` is an operator act and is
    // checked first. Nothing produces this pair today; the test pins the rule
    // rather than leaving it to whoever reads the if-chain next.
    const rows = computeStandingsRows(
      input({
        completedMatches: [bout('m-both', A, 0, B, 0, null, 'max_doubles')],
        drawnForfeitMatchIds: new Set(['m-both']),
      }),
    );

    expect(statsOf(rows, A)).toMatchObject({ W: 0, L: 0, D: 1 });
  });

  it('forces a draw for a bout named in drawnForfeitMatchIds, whatever the scores say', () => {
    const rows = computeStandingsRows(
      input({
        completedMatches: [bout('m-ff', A, 5, B, 0, A)],
        drawnForfeitMatchIds: new Set(['m-ff']),
      }),
    );

    expect(statsOf(rows, A)).toMatchObject({ W: 0, L: 0, D: 1 });
    expect(statsOf(rows, B)).toMatchObject({ W: 0, L: 0, D: 1 });
  });
});

describe('computeStandingsRows — points for and against', () => {
  it('credits each score to the right side of both fighters', () => {
    const rows = computeStandingsRows(input({ completedMatches: [bout('m-1', A, 5, B, 3, A)] }));

    expect(statsOf(rows, A)).toMatchObject({ ptsScored: 5, ptsConceded: 3 });
    expect(statsOf(rows, B)).toMatchObject({ ptsScored: 3, ptsConceded: 5 });
  });

  it('skips a bout whose fighters are not both on this member list', () => {
    const rows = computeStandingsRows(
      input({
        completedMatches: [
          bout('m-1', A, 5, B, 3, A),
          bout('m-2', A, 9, 'reg-stranger', 0, A),
          bout('m-3', 'reg-stranger', 7, B, 0, 'reg-stranger'),
        ],
      }),
    );

    expect(statsOf(rows, A)).toMatchObject({ ptsScored: 5, ptsConceded: 3, W: 1 });
    expect(statsOf(rows, B)).toMatchObject({ ptsScored: 3, ptsConceded: 5, L: 1 });
  });
});

describe('computeStandingsRows — only the declared columns', () => {
  it('gives a fighter exactly the columns the ruleset declared, and no extras', () => {
    const rows = computeStandingsRows(input({ columns: [col('W'), col('L')] }));
    const stats = statsOf(rows, A);

    expect(Object.keys(stats).sort()).toEqual(['L', 'W']);
    for (const key of ['diff', 'hitsGiven', 'hitsReceived', 'doubles', 'score', 'F']) {
      expect(key in stats).toBe(false);
    }
  });

  it('fills diff only when a diff column is declared', () => {
    const bouts = [bout('m-1', A, 5, B, 3, A)];

    const without = computeStandingsRows(input({ completedMatches: bouts }));
    expect('diff' in statsOf(without, A)).toBe(false);

    const declared = computeStandingsRows(
      input({ columns: [col('W'), col('diff')], completedMatches: bouts }),
    );
    expect(statsOf(declared, A)['diff']).toBe(2);
    expect(statsOf(declared, B)['diff']).toBe(-2);
  });
});

describe('computeStandingsRows — the ruleset score', () => {
  it('does not consult the ruleset when no score column is declared', () => {
    const stub = stubRuleset({ [A]: 4 });

    computeStandingsRows(
      input({ ruleset: stub.ruleset, completedMatches: [bout('m-1', A, 5, B, 3, A)] }),
    );

    expect(stub.scorePoolFighters).not.toHaveBeenCalled();
  });

  it('takes the score from the ruleset and rounds it to two decimals', () => {
    const stub = stubRuleset({ [A]: 3.14159, [B]: 2 });

    const rows = computeStandingsRows(
      input({
        ruleset: stub.ruleset,
        columns: [col('W'), col('score')],
        completedMatches: [bout('m-1', A, 5, B, 3, A)],
      }),
    );

    expect(stub.scorePoolFighters).toHaveBeenCalledOnce();
    expect(statsOf(rows, A)['score']).toBe(3.14);
    expect(statsOf(rows, B)['score']).toBe(2);
  });

  it('carries a forced score even when the ruleset declares no score column', () => {
    const stub = stubRuleset({ [A]: 3.14159 });

    const rows = computeStandingsRows(
      input({
        ruleset: stub.ruleset,
        columns: [col('W')],
        forceScore: true,
        completedMatches: [bout('m-1', A, 5, B, 3, A)],
      }),
    );

    expect(stub.scorePoolFighters).toHaveBeenCalledOnce();
    expect(statsOf(rows, A)['score']).toBe(3.14);
  });
});

describe('computeStandingsRows — forfeits', () => {
  it('reads the forfeit count off the map it was given', () => {
    const rows = computeStandingsRows(
      input({ columns: [col('W'), col('F')], forfeitCountByReg: new Map([[A, 2]]) }),
    );

    expect(statsOf(rows, A)['F']).toBe(2);
    expect(statsOf(rows, B)['F']).toBe(0);
  });
});

describe('computeStandingsRows — exchange aggregates and the afterblow mode', () => {
  const EXCHANGE_COLUMNS = [col('W'), col('hitsGiven'), col('hitsReceived'), col('doubles')];

  it('accumulates hits given, hits received and doubles from the exchanges', () => {
    const rows = computeStandingsRows(
      input({
        columns: EXCHANGE_COLUMNS,
        completedMatches: [bout('m-1', A, 3, B, 1, A)],
        exchangesByMatch: new Map([
          [
            'm-1',
            [
              exchange({ id: 'x-1', sequence: 1, firstStrikerColor: 'red', firstStrikeValue: 2 }),
              exchange({ id: 'x-2', sequence: 2, firstStrikerColor: 'blue', firstStrikeValue: 1 }),
              exchange({
                id: 'x-3',
                sequence: 3,
                type: 'double',
                firstStrikerColor: null,
                firstStrikeValue: null,
              }),
            ],
          ],
        ]),
      }),
    );

    expect(statsOf(rows, A)).toMatchObject({ hitsGiven: 2, hitsReceived: 1, doubles: 1 });
    expect(statsOf(rows, B)).toMatchObject({ hitsGiven: 1, hitsReceived: 1, doubles: 1 });
  });

  const AFTERBLOW = new Map([
    [
      'm-1',
      [
        exchange({
          type: 'afterblow',
          firstStrikerColor: 'red',
          firstStrikeValue: 2,
          afterblowValue: 1,
        }),
      ],
    ],
  ]);

  it('nets the afterblow in full by default — the attacker keeps every point', () => {
    const rows = computeStandingsRows(
      input({
        columns: EXCHANGE_COLUMNS,
        completedMatches: [bout('m-1', A, 2, B, 1, A)],
        exchangesByMatch: AFTERBLOW,
      }),
    );

    expect(statsOf(rows, A)).toMatchObject({ hitsGiven: 2, hitsReceived: 1 });
    expect(statsOf(rows, B)).toMatchObject({ hitsGiven: 1, hitsReceived: 0 });
  });

  it('deducts the afterblow from the attacker when the mode says so', () => {
    const rows = computeStandingsRows(
      input({
        columns: EXCHANGE_COLUMNS,
        afterblowMode: 'deductive',
        completedMatches: [bout('m-1', A, 2, B, 1, A)],
        exchangesByMatch: AFTERBLOW,
      }),
    );

    expect(statsOf(rows, A)).toMatchObject({ hitsGiven: 1, hitsReceived: 1 });
    expect(statsOf(rows, B)).toMatchObject({ hitsGiven: 0, hitsReceived: 0 });
  });
});

describe('computeStandingsRows — the row itself', () => {
  it('names the fighter given-name first, and carries the club and the status', () => {
    const rows = computeStandingsRows(
      input({
        status: 'in_progress',
        members: [
          {
            registration_id: A,
            registrations: {
              id: 'row-a',
              persons: {
                id: 'person-a',
                given_name: 'Ada',
                family_name: 'Lovelace',
                clubs: { id: 'club-1', name: 'Lyon AMHE', abbreviation: 'LAM' },
              },
            },
          },
        ],
      }),
    );

    expect(rows[0]).toMatchObject({
      registrationId: A,
      displayName: 'Ada Lovelace',
      club: { id: 'club-1', name: 'Lyon AMHE', abbreviation: 'LAM' },
      status: 'in_progress',
    });
  });

  it('returns the rows ranked by the chain, not in member order', () => {
    const rows = computeStandingsRows(
      input({
        members: [member(A, 'Ada'), member(B, 'Bo'), member(C, 'Cy')],
        completedMatches: [
          bout('m-1', C, 5, A, 0, C),
          bout('m-2', C, 5, B, 0, C),
          bout('m-3', A, 5, B, 0, A),
        ],
      }),
    );

    expect(rows.map((row) => row.registrationId)).toEqual([C, A, B]);
    expect(rows.map((row) => row.rank)).toEqual([1, 2, 3]);
  });
});
