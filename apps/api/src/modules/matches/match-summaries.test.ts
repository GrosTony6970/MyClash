import { Logger } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
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
    expect(matchFormat?.bestOf).toEqual({ pool: 3, bracket: 5, finals: 5 });
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

  it('names a bracket round by the size of its main bracket', async () => {
    const seed = summarySeed();
    const supabase = mockSupabase({
      ...seed,
      phases: { rows: [{ id: 'phase-de', config_json: { mainBracketSize: 8 } }] },
    });

    const summaries = await matchSummaries(supabase.service as never, ['bracket']);

    // Round 2 of eight is the semi-final. With no size it is "round 2".
    expect(summaries.get('bracket')).toMatchObject({ roundCode: 'SBR-B-SF-M2', roundToken: 'SF' });
  });

  it('reads the phase of a bracket bout only, and no Pool or piste that no bout names', async () => {
    const { from } = await read();
    expect(filtersFor(from, 'phases', 'in')).toEqual([['id', ['phase-de']]]);
    // Three of the four bouts are of one Tournament: its id is asked once.
    expect(filtersFor(from, 'tournaments', 'in')).toEqual([['id', ['t1', 't2']]]);

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
      'id, lice_id, current_round, red_round_wins, blue_round_wins, rounds_json, awaiting_round_advance, match_rules(ruleset_config)',
    ]);
    // The format is the bout's copy's: the Tournament's of now is not read.
    expect(selectsFor(from, 'tournaments')).toEqual(['id, weapon, name, scoring_config_json']);
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

  /** The four bouts, with the `matches` row of one bout changed by `change`. */
  const withBout = (
    id: string,
    change: (row: Record<string, unknown>) => Record<string, unknown>,
  ) => {
    const seed = summarySeed();
    const rows = (seed.matches as { rows: Record<string, unknown>[] }).rows;
    return {
      ...seed,
      matches: { rows: rows.map((row) => (row['id'] === id ? change(row) : row)) },
    };
  };

  // Every write checks a format, so only a hand edit gets here: one such bout threw out of the
  // whole list (a piste's bouts, the referee assignments, the match lists).
  it("lists every bout when one bout's stored format does not read", async () => {
    const supabase = mockSupabase(
      withBout('bracket', (row) => ({
        ...row,
        match_rules: { ruleset_config: { matchFormat: { pointCap: 0 } } },
      })),
    );
    const logged = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    const summaries = await matchSummaries(supabase.service as never, SUMMARY_BOUTS);

    expect(summaries.get('bracket')).toMatchObject({ matchFormat: null, bestOf: 1 });
    expect(summaries.get('pool')?.matchFormat?.bestOf).toEqual({ pool: 3, bracket: 5, finals: 5 });
    expect(logged).toHaveBeenCalledWith(
      'Bout bracket has a match format that does not read',
      expect.anything(),
    );
    logged.mockRestore();
  });

  // Ruling E: a bout keeps the format it started under, and the public bout page shows it. The
  // organiser then makes the Tournament best of one: the bout is still best of three.
  it('gives a bout the format of its copy, when its Tournament now says another', async () => {
    const seed = summarySeed();
    const supabase = mockSupabase({
      ...seed,
      tournaments: {
        rows: (seed.tournaments as { rows: Record<string, unknown>[] }).rows.map((t) =>
          t['id'] === 't1'
            ? {
                ...t,
                ruleset_config: { matchFormat: { bestOf: { pool: 1, bracket: 1, finals: 1 } } },
              }
            : t,
        ),
      },
    });

    const summaries = await matchSummaries(supabase.service as never, ['pool']);

    expect(summaries.get('pool')?.bestOf).toBe(3);
    expect(summaries.get('pool')?.matchFormat?.bestOf).toEqual({ pool: 3, bracket: 5, finals: 5 });
  });

  // Every bout holds a copy: one with none is a fault. It must not take the list down with it,
  // and it must not borrow its Tournament's format of now.
  it('lists a bout with no copy of its rules with no format, the others intact, and names it', async () => {
    const supabase = mockSupabase(withBout('swiss', ({ match_rules: _copy, ...row }) => row));
    const logged = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    const summaries = await matchSummaries(supabase.service as never, SUMMARY_BOUTS);

    expect(summaries.get('swiss')).toMatchObject({
      matchFormat: null,
      bestOf: 1,
      roundToken: 'S3',
    });
    expect(summaries.get('pool')).toMatchObject({ bestOf: 3, liceName: 'Lice 4' });
    expect(summaries.get('pool')?.matchFormat?.bestOf).toEqual({ pool: 3, bracket: 5, finals: 5 });
    expect([...summaries.keys()]).toEqual(SUMMARY_BOUTS);
    expect(logged).toHaveBeenCalledWith('Bout swiss holds no copy of its rules');
    expect(logged).toHaveBeenCalledTimes(1);
    logged.mockRestore();
  });

  // The piste read polls the list: a bout deleted between its two reads is an ordinary race, not
  // a fault to log at every poll.
  it('lists a bout deleted since the list was read with no format, and logs nothing', async () => {
    const supabase = mockSupabase(withBout('swiss', () => ({ id: 'deleted-since' })));
    const logged = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    const summaries = await matchSummaries(supabase.service as never, SUMMARY_BOUTS);

    expect(summaries.get('swiss')).toMatchObject({ matchFormat: null, bestOf: 1 });
    expect(logged).not.toHaveBeenCalled();
    logged.mockRestore();
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
