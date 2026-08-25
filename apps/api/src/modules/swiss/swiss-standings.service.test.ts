import { describe, expect, it } from 'vitest';

import { mockSupabase, type SupabaseRow } from '../../common/testing/supabase-chain';
import { RulesetResolver } from '../matches/ruleset-resolver.service';
import { asSupabase as as, swissConfig } from './swiss.fixtures';
import { SwissStandingsService } from './swiss-standings.service';
import { createRulesetRegistry } from '../rulesets/ruleset-registry';

/**
 * An entrant of p1, in the shape the standings reader joins names from.
 *
 * Richer than the pairing fixtures' entrant: the standings table shows a
 * person, so the registration embed has to reach one.
 */
const standingsEntrant = (
  registrationId: string,
  givenName: string,
  withdrawnAtRound: number | null = null,
): SupabaseRow => ({
  phase_id: 'p1',
  registration_id: registrationId,
  withdrawn_at_round: withdrawnAtRound,
  registrations: {
    id: registrationId,
    persons: {
      id: `person-${registrationId}`,
      given_name: givenName,
      family_name: 'Fighter',
      clubs: null,
    },
  },
});

const round = (id: string, roundNumber: number, over: SupabaseRow = {}): SupabaseRow => ({
  id,
  phase_id: 'p1',
  round_number: roundNumber,
  status: 'completed',
  bye_registration_id: null,
  ...over,
});

/** A completed bout of `roundId`, won by `winner` unless told otherwise. */
const bout = (
  id: string,
  roundId: string,
  red: string,
  blue: string,
  over: SupabaseRow = {},
): SupabaseRow => ({
  id,
  phase_id: 'p1',
  swiss_round_id: roundId,
  status: 'completed',
  end_reason: null,
  red_registration_id: red,
  blue_registration_id: blue,
  red_score: 5,
  blue_score: 3,
  winner_registration_id: red,
  ...over,
});

const build = (over: Record<string, unknown> = {}) => {
  const supabase = mockSupabase({
    tournaments: {
      rows: [
        {
          id: 't1',
          ruleset_code: 'Generic_PointsCap',
          ruleset_version: '1.0.0',
          ruleset_config: null,
          scoring_config_json: null,
        },
      ],
    },
    phases: {
      rows: [
        { id: 'p1', type: 'swiss', tournament_id: 't1', config_json: swissConfig() },
        // Another tournament's Swiss phase.
        { id: 'p2', type: 'swiss', tournament_id: 't2', config_json: swissConfig() },
      ],
    },
    swiss_entrants: {
      rows: [
        standingsEntrant('r1', 'Ada'),
        standingsEntrant('r2', 'Grace'),
        // Another phase's entrant.
        { ...standingsEntrant('rX', 'Nobody'), phase_id: 'p2' },
      ],
    },
    swiss_rounds: { rows: [round('sr1', 1)] },
    matches: { rows: [bout('m1', 'sr1', 'r1', 'r2')] },
    exchanges: { rows: [] as SupabaseRow[] },
    match_forfeits: { rows: [] as SupabaseRow[] },
    ...over,
  });
  return {
    supabase,
    service: new SwissStandingsService(
      as(supabase),
      new RulesetResolver(as(supabase), createRulesetRegistry()),
    ),
  };
};

/** registrationId -> Swiss points, which is what the table is ranked on. */
const points = (rows: Array<{ registrationId: string; stats: Record<string, unknown> }>) =>
  Object.fromEntries(rows.map((r) => [r.registrationId, r.stats['swissPts']]));

describe('SwissStandingsService — the points a result is worth', () => {
  it('awards the configured points for a win and a loss', async () => {
    const { service } = build();

    const standings = await service.getSwissStandings('t1');

    expect(points(standings.rows)).toEqual({ r1: 3, r2: 0 });
  });

  it('awards both fighters the draw points when nobody won', async () => {
    const { service } = build({
      matches: {
        rows: [bout('m1', 'sr1', 'r1', 'r2', { winner_registration_id: null, blue_score: 5 })],
      },
    });

    const standings = await service.getSwissStandings('t1');

    expect(points(standings.rows)).toEqual({ r1: 1, r2: 1 });
  });

  it('scores a double cap as a loss for both fighters', async () => {
    // Both failed to win it, so neither is credited with a draw.
    const { service } = build({
      matches: {
        rows: [
          bout('m1', 'sr1', 'r1', 'r2', {
            end_reason: 'max_doubles',
            winner_registration_id: null,
          }),
        ],
      },
    });

    const standings = await service.getSwissStandings('t1');

    expect(points(standings.rows)).toEqual({ r1: 0, r2: 0 });
    // AND the W/L/D columns beside them agree. They are filled by the shared
    // pool helper, which was handed a projection with `end_reason` stripped —
    // so one row of one table said double loss in Swiss points and DRAW in
    // W/L/D, from the same loaded column.
    for (const row of standings.rows) {
      expect(row.stats).toMatchObject({ W: 0, L: 1, D: 0 });
    }
  });

  it('awards the bye points to whoever sat the round out', async () => {
    const { service } = build({
      swiss_rounds: { rows: [round('sr1', 1, { bye_registration_id: 'r2' })] },
      matches: { rows: [] },
    });

    const standings = await service.getSwissStandings('t1');

    expect(points(standings.rows)).toEqual({ r1: 0, r2: 3 });
    expect(standings.rows.find((r) => r.registrationId === 'r2')?.stats['byes']).toBe(1);
  });

  it('ignores a bout that has not been fought to a result', async () => {
    const { service } = build({
      matches: { rows: [bout('m1', 'sr1', 'r1', 'r2', { status: 'running' })] },
    });

    const standings = await service.getSwissStandings('t1');

    expect(points(standings.rows)).toEqual({ r1: 0, r2: 0 });
  });

  it('ignores a bout that belongs to no round of this phase', async () => {
    // A Swiss match whose round was deleted still carries the old round id.
    const { service } = build({
      matches: { rows: [bout('m1', 'sr-gone', 'r1', 'r2')] },
    });

    const standings = await service.getSwissStandings('t1');

    expect(points(standings.rows)).toEqual({ r1: 0, r2: 0 });
  });
});

describe('SwissStandingsService — who appears in the table', () => {
  it('keeps a withdrawn fighter, ranked on what they played', async () => {
    // Decision 11: the rounds they fought still stand, and still count toward
    // their opponents' tiebreaks.
    const { service } = build({
      swiss_entrants: {
        rows: [standingsEntrant('r1', 'Ada'), standingsEntrant('r2', 'Grace', 2)],
      },
    });

    const standings = await service.getSwissStandings('t1');

    expect(standings.rows.find((r) => r.registrationId === 'r2')).toMatchObject({
      withdrawn: true,
      withdrawnAtRound: 2,
    });
  });

  it('marks a fighter who is still in as not withdrawn', async () => {
    const { service } = build();

    const standings = await service.getSwissStandings('t1');

    expect(standings.rows.find((r) => r.registrationId === 'r1')).toMatchObject({
      withdrawn: false,
      withdrawnAtRound: null,
    });
  });

  it('leaves out the entrants of another phase', async () => {
    const { service } = build();

    const standings = await service.getSwissStandings('t1');

    expect(standings.rows.map((r) => r.registrationId).sort()).toEqual(['r1', 'r2']);
  });
});

describe('SwissStandingsService — what the table reports about the phase', () => {
  it('answers with the tournament ruleset when there is no Swiss phase', async () => {
    // The standings route is reachable before a Swiss phase exists, so the
    // columns still have to come from somewhere.
    const { service } = build({
      phases: { rows: [{ id: 'p-pool', type: 'pool', tournament_id: 't1', config_json: null }] },
    });

    const standings = await service.getSwissStandings('t1');

    expect(standings).toMatchObject({
      phaseId: null,
      rulesetCode: 'Generic_PointsCap',
      roundsCompleted: 0,
      roundCount: 0,
      finalized: null,
      rows: [],
    });
    expect(standings.columns.length).toBeGreaterThan(0);
  });

  it('counts the rounds that are finished against the rounds planned', async () => {
    const { service } = build({
      swiss_rounds: {
        rows: [round('sr1', 1), round('sr2', 2), round('sr3', 3, { status: 'pending' })],
      },
    });

    const standings = await service.getSwissStandings('t1');

    expect(standings).toMatchObject({ roundsCompleted: 2, roundCount: 5 });
  });

  it('reports the standings freeze', async () => {
    const { service } = build({
      phases: {
        rows: [
          {
            id: 'p1',
            type: 'swiss',
            tournament_id: 't1',
            config_json: {
              ...swissConfig(),
              finalized: { atRound: 4, at: '2026-08-18T10:00:00.000Z', byUserId: null },
            },
          },
        ],
      },
    });

    const standings = await service.getSwissStandings('t1');

    expect(standings.finalized).toMatchObject({ atRound: 4 });
  });

  it('puts the Swiss points column ahead of the ruleset’s own', async () => {
    // A reader must be able to see the number a placing was decided on, and
    // Swiss points decide it before any ruleset column does.
    const { service } = build();

    const standings = await service.getSwissStandings('t1');

    expect(standings.columns[0]).toMatchObject({ key: 'swissPts' });
    expect(standings.columns.map((c) => c.key)).toContain('buchholz');
  });

  it('carries the configured tiebreak chain, and how it ranks', async () => {
    const { service } = build();

    const standings = await service.getSwissStandings('t1');

    expect(standings).toMatchObject({
      rankBy: 'swissPts',
      tiebreakChain: ['buchholz', 'sonnebornBerger', 'rulesetChain'],
    });
  });
});

describe('SwissStandingsService — separating fighters who are level', () => {
  it('ranks the fighter with more Swiss points first', async () => {
    const { service } = build();

    const standings = await service.getSwissStandings('t1');

    expect(standings.rows.map((r) => r.registrationId)).toEqual(['r1', 'r2']);
  });

  it('separates two fighters level on points by the bout between them', async () => {
    // Three rounds, arranged so r1 and r2 finish on the same points:
    //
    //   R1  r1 beat r3      r2 beat r4
    //   R2  r2 beat r1      r4 beat r3
    //   R3  r1 beat r4      r3 beat r2
    //
    // Two wins each. Nothing above head-to-head in the chain can split them,
    // so the bout they fought each other is the only thing left — and the
    // chain has to be told to use it.
    const { service } = build({
      phases: {
        rows: [
          {
            id: 'p1',
            type: 'swiss',
            tournament_id: 't1',
            config_json: { ...swissConfig(), tiebreakChain: ['headToHead', 'rulesetChain'] },
          },
        ],
      },
      swiss_entrants: {
        rows: [
          standingsEntrant('r1', 'Ada'),
          standingsEntrant('r2', 'Grace'),
          standingsEntrant('r3', 'Alan'),
          standingsEntrant('r4', 'Edsger'),
        ],
      },
      swiss_rounds: { rows: [round('sr1', 1), round('sr2', 2), round('sr3', 3)] },
      matches: {
        rows: [
          bout('m1', 'sr1', 'r1', 'r3'),
          bout('m2', 'sr1', 'r2', 'r4'),
          // They meet here, and r2 wins.
          bout('m3', 'sr2', 'r1', 'r2', {
            winner_registration_id: 'r2',
            red_score: 3,
            blue_score: 5,
          }),
          bout('m4', 'sr2', 'r3', 'r4', {
            winner_registration_id: 'r4',
            red_score: 3,
            blue_score: 5,
          }),
          bout('m5', 'sr3', 'r1', 'r4'),
          bout('m6', 'sr3', 'r2', 'r3', {
            winner_registration_id: 'r3',
            red_score: 3,
            blue_score: 5,
          }),
        ],
      },
    });

    const standings = await service.getSwissStandings('t1');

    // Level on six points each, and r2 is placed first because r2 beat r1.
    expect(points(standings.rows)).toMatchObject({ r1: 6, r2: 6 });
    const order = standings.rows.map((r) => r.registrationId);
    expect(order.indexOf('r2')).toBeLessThan(order.indexOf('r1'));
  });
});
