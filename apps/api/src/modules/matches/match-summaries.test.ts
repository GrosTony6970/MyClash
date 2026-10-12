import { describe, expect, it } from 'vitest';
import {
  filtersFor,
  mockSupabase,
  queriedTables,
  selectsFor,
} from '../../common/testing/supabase-chain';
import { matchSummaries } from './match-summaries';
import { SUMMARY_BOUTS, summarySeed } from './match-summaries.fixtures';

/**
 * The header summary of a bout, for one bout and for many. The values below
 * were compared, field for field and in key order, with the answers of the
 * single-bout code this builder replaced (2026-10-13), on the same four bouts.
 */
describe('matchSummaries', () => {
  const read = async (ids: string[] = SUMMARY_BOUTS) => {
    const supabase = mockSupabase(summarySeed());
    return { summaries: await matchSummaries(supabase.service as never, ids), from: supabase.from };
  };

  it('names a Pool bout on a piste, with its rounds and its referee', async () => {
    const { summaries } = await read();
    const { matchFormat, ...rest } = summaries.get('pool')!;

    expect(rest).toEqual({
      matchLabel: 'L1-P1-M3',
      roundCode: 'LSW-P2-M3',
      roundToken: null,
      status: 'scheduled',
      poolName: 'Pool B',
      tournamentName: 'Open Longsword',
      liceName: 'Lice 4',
      redName: 'Red pool',
      redClub: 'AAA',
      blueName: 'Blue pool',
      blueClub: null,
      eventTimezone: 'Europe/Lisbon',
      referees: ['Rita Ref'],
      weapon: 'longsword',
      tournamentId: 't1',
      phaseType: 'pool',
      scoringConfig: { sides: { a: 'gold' } },
      bestOf: 3,
      currentRound: 2,
      redRoundWins: 1,
      blueRoundWins: 0,
      roundsJson: [{ round: 1 }],
      awaitingRoundAdvance: true,
    });
    expect(matchFormat.bestOf).toEqual({ pool: 3, bracket: 5, finals: 5 });
  });

  it('names a double-elimination bout of another Tournament, with no piste', async () => {
    const { summaries } = await read();

    expect(summaries.get('bracket')).toMatchObject({
      roundCode: 'SBR-B-WBSF-M2',
      roundToken: 'WBSF',
      tournamentName: 'Sabre',
      weapon: 'sabre',
      tournamentId: 't2',
      liceName: '',
      referees: [],
      scoringConfig: null,
      bestOf: 1,
      currentRound: 1,
      roundsJson: null,
      awaitingRoundAdvance: false,
    });
  });

  it('names a Swiss bout, and a bout with no phase whose piste is gone', async () => {
    const { summaries } = await read();

    expect(summaries.get('swiss')).toMatchObject({
      roundCode: 'LSW-S3-M3',
      roundToken: 'S3',
      redName: '',
      liceName: 'Lice 4',
      bestOf: 3,
      // Not a list: the pad would walk it.
      roundsJson: null,
    });
    expect(summaries.get('bare')).toMatchObject({
      matchLabel: '',
      roundCode: 'LSW',
      roundToken: null,
      liceName: '',
      phaseType: null,
      referees: [],
    });
  });

  it('answers one bout as it answers that bout among many', async () => {
    const { summaries: all } = await read();
    for (const id of SUMMARY_BOUTS) {
      const { summaries: one } = await read([id]);
      expect(one.get(id)).toEqual(all.get(id));
    }
  });

  it('gives a bout the view does not hold no entry, and reads nothing for no bout', async () => {
    const { summaries } = await read(['pool', 'unknown']);
    expect([...summaries.keys()]).toEqual(['pool']);

    const none = await read([]);
    expect(none.summaries.size).toBe(0);
    expect(queriedTables(none.from)).toEqual([]);
  });

  // The point of the builder: sixty bouts cost what four cost.
  it('reads each table once for the four bouts', async () => {
    const { from } = await read();

    expect(queriedTables(from).sort()).toEqual([
      'events',
      'lices',
      'matches',
      'phases',
      'pools',
      'referee_assignments',
      'referee_skills',
      'tournaments',
      'vw_tournament_query_matches',
    ]);
  });

  it('reads the phase of a bracket bout only, and no Pool or piste that no bout names', async () => {
    const { from } = await read();
    expect(filtersFor(from, 'phases', 'in')).toEqual([['id', ['phase-de']]]);

    // The double refuses a table that is not seeded: these reads are not made.
    const { pools: _pools, phases: _phases, ...noPoolNoPhase } = summarySeed();
    const bare = await matchSummaries(mockSupabase(noPoolNoPhase).service as never, ['bare']);
    expect(bare.has('bare')).toBe(true);

    const { lices: _lices, ...noPiste } = summarySeed();
    const bracket = await matchSummaries(mockSupabase(noPiste).service as never, ['bracket']);
    expect(bracket.has('bracket')).toBe(true);
  });

  // The double answers the whole row whatever is selected: a column taken out
  // of a select would leave every value above in place.
  it('selects the columns it reads', async () => {
    const { from } = await read();

    expect(selectsFor(from, 'vw_tournament_query_matches')).toEqual([
      'match_id, match_number_label, status, pool_id, pool_name, bracket_round, swiss_round, red_name, blue_name, red_club, blue_club, tournament_id, event_id, phase_id, phase_type',
    ]);
    expect(selectsFor(from, 'matches')).toEqual([
      'id, lice_id, current_round, red_round_wins, blue_round_wins, rounds_json, awaiting_round_advance',
    ]);
    expect(selectsFor(from, 'tournaments')).toEqual([
      'id, weapon, name, ruleset_config, scoring_config_json',
    ]);
    expect(selectsFor(from, 'phases')).toEqual(['id, config_json']);
    expect(selectsFor(from, 'pools')).toEqual(['id, sort_order']);
    expect(selectsFor(from, 'events')).toEqual(['id, timezone']);
    expect(selectsFor(from, 'lices')).toEqual(['id, name']);
  });

  it('asks for a long list of bouts a hundred ids at a time', async () => {
    const ids = Array.from({ length: 101 }, (_, n) => `bout-${n}`);
    const { from } = await read(ids);

    const lists = filtersFor(from, 'vw_tournament_query_matches', 'in').map(
      ([, list]) => (list as string[]).length,
    );
    expect(lists).toEqual([100, 1]);
  });

  // A summary built without its Tournament would name no weapon and no rounds,
  // and the tablet would keep that as the bout.
  it('throws when a read fails', async () => {
    const supabase = mockSupabase({
      ...summarySeed(),
      tournaments: { data: null, error: { message: 'connection lost' } },
    });

    await expect(matchSummaries(supabase.service as never, SUMMARY_BOUTS)).rejects.toThrow(
      'tournaments: connection lost',
    );
  });

  // The first read too: a database fault is the server's (a 5xx), not the
  // caller's. It was answered as a 400.
  it('throws a plain error when the read of the view fails', async () => {
    const supabase = mockSupabase({
      vw_tournament_query_matches: { data: null, error: { message: 'connection lost' } },
    });

    const failure = await matchSummaries(supabase.service as never, ['pool']).catch(
      (error: unknown) => error,
    );
    expect(failure).toEqual(new Error('vw_tournament_query_matches: connection lost'));
    expect(failure).not.toHaveProperty('getStatus');
  });
});
