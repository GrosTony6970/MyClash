import { describe, expect, it } from 'vitest';
import { mockSupabase } from '../../common/testing/supabase-chain';
import {
  asSupabase as as,
  namedEntrant,
  phaseRow,
  swissConfig,
  swissRound,
  swissViewState as state,
  viewBout,
} from './swiss.fixtures';
import { SwissPublicRoundsService } from './swiss-public-rounds.service';

const build = (over: Record<string, unknown> = {}) => {
  const supabase = mockSupabase(state(over));
  return { supabase, service: new SwissPublicRoundsService(as(supabase)) };
};

/** The config with a value overridden, wrapped in the phase row that holds it. */
const phaseWithConfig = (over: Record<string, unknown>) =>
  phaseRow({ config_json: { ...swissConfig(), ...over } });

describe('SwissPublicRoundsService — the phase a spectator is shown', () => {
  it('finds this tournament’s Swiss phase and not its pool one', async () => {
    // The table also holds this tournament's pool phase and another
    // tournament's Swiss phase.
    const { service } = build();

    const rounds = await service.getRounds('t1');

    expect(rounds.phaseId).toBe('p1');
  });

  it('answers for a tournament with no Swiss phase', async () => {
    // The public page is reachable before a Swiss phase exists, so this has to
    // be a payload rather than a 404 — and the side colours still apply.
    const { service } = build({
      phases: { rows: [{ id: 'p-pool', type: 'pool', tournament_id: 't1', config_json: null }] },
    });

    const rounds = await service.getRounds('t1');

    expect(rounds).toEqual({
      phaseId: null,
      roundCount: 0,
      roundsCompleted: 0,
      finalized: null,
      sideColors: { red: 'red', blue: 'blue' },
      rounds: [],
    });
  });

  it('takes the side colours this tournament configured', async () => {
    // Per-item colours: a tournament that fights in black and purple must not
    // be drawn in red and blue.
    const { service } = build({
      tournaments: {
        rows: [
          {
            id: 't1',
            scoring_config_json: { display: { sideColors: { red: 'black', blue: 'purple' } } },
          },
          { id: 't2', scoring_config_json: { display: { sideColors: { red: 'green' } } } },
        ],
      },
    });

    const rounds = await service.getRounds('t1');

    expect(rounds.sideColors).toEqual({ red: 'black', blue: 'purple' });
  });
});

describe('SwissPublicRoundsService — how far the phase has got', () => {
  it('reports the planned round count, not the number played so far', async () => {
    // One round exists of the five the phase is configured for. A spectator
    // needs the total to read "round 1 of 5".
    const { service } = build();

    const rounds = await service.getRounds('t1');

    expect(rounds.roundCount).toBe(5);
    expect(rounds.rounds).toHaveLength(1);
  });

  it('falls back to the rounds that exist when the config cannot be read', async () => {
    // An unparsable config must not report a round count of zero on a phase
    // that has already been fought.
    const { service } = build({ phases: { rows: [phaseRow({ config_json: { junk: true } })] } });

    const rounds = await service.getRounds('t1');

    expect(rounds.roundCount).toBe(1);
  });

  it('counts the rounds that are finished', async () => {
    const { service } = build({
      swiss_rounds: {
        rows: [
          swissRound({ id: 'sr1', round_number: 1, status: 'completed' }),
          swissRound({ id: 'sr2', round_number: 2, status: 'completed' }),
          swissRound({ id: 'sr3', round_number: 3, status: 'pending' }),
        ],
      },
    });

    const rounds = await service.getRounds('t1');

    expect(rounds.roundsCompleted).toBe(2);
    expect(rounds.rounds).toHaveLength(3);
  });

  it('reports the standings freeze, without the user who froze them', async () => {
    // Decision 13. The organiser's id is on the config and must not reach a
    // public payload; the round and the moment are what a spectator is owed.
    const { service } = build({
      phases: {
        rows: [
          phaseWithConfig({
            finalized: {
              atRound: 4,
              at: '2026-08-18T10:00:00.000Z',
              byUserId: '11111111-1111-4111-8111-111111111111',
            },
          }),
        ],
      },
    });

    const rounds = await service.getRounds('t1');

    expect(rounds.finalized).toEqual({ atRound: 4, at: '2026-08-18T10:00:00.000Z' });
  });

  it('reports a phase nobody has frozen', async () => {
    const { service } = build();

    const rounds = await service.getRounds('t1');

    expect(rounds.finalized).toBeNull();
  });
});

describe('SwissPublicRoundsService — the rounds themselves', () => {
  it('reads the rounds of this phase, in round order', async () => {
    // Seeded out of order, with another phase's round in the table.
    const { service } = build({
      swiss_rounds: {
        rows: [
          swissRound({ id: 'sr2', round_number: 2 }),
          swissRound({ id: 'sr-p2', phase_id: 'p2', round_number: 1 }),
          swissRound({ id: 'sr1', round_number: 1 }),
        ],
      },
    });

    const rounds = await service.getRounds('t1');

    expect(rounds.rounds.map((r) => r.id)).toEqual(['sr1', 'sr2']);
  });

  it('shows the bouts of this phase, in board order, with both names', async () => {
    // Another phase's bout sits in the same table, and the labels carry no
    // zero so a text sort and a board sort disagree.
    const { service } = build({
      matches: {
        rows: [
          viewBout('m10', 'SW-R1-M10'),
          viewBout('m2', 'SW-R1-M2', { red_registration_id: 'r3', blue_registration_id: 'r4' }),
          viewBout('m1', 'SW-R1-M1'),
          viewBout('m-p2', 'SW-R1-M1', { phase_id: 'p2' }),
        ],
      },
    });

    const rounds = await service.getRounds('t1');

    expect(rounds.rounds[0]?.matches.map((m) => m.matchNumberLabel)).toEqual([
      'SW-R1-M1',
      'SW-R1-M2',
      'SW-R1-M10',
    ]);
    expect(rounds.rounds[0]?.matches[0]).toMatchObject({
      redFighterName: 'Ada Lovelace',
      blueFighterName: 'Grace Hopper',
      liceName: 'Piste 1',
    });
  });

  it('names the fighter sitting the round out', async () => {
    const { service } = build({
      swiss_rounds: { rows: [swissRound({ id: 'sr1', bye_registration_id: 'r3' })] },
    });

    const rounds = await service.getRounds('t1');

    expect(rounds.rounds[0]).toMatchObject({
      byeRegistrationId: 'r3',
      byeFighterName: 'Alan Turing',
    });
  });

  it('still names a fighter who has since withdrawn', async () => {
    // A withdrawal's played bouts stay on the board, so dropping withdrawn
    // entrants from the name index would blank an opponent's name on a round
    // that was actually fought.
    const { service } = build({
      swiss_entrants: {
        rows: [
          { ...namedEntrant('r1', 'Ada', 'Lovelace'), withdrawn_at_round: 2 },
          namedEntrant('r2', 'Grace', 'Hopper'),
        ],
      },
    });

    const rounds = await service.getRounds('t1');

    expect(rounds.rounds[0]?.matches[0]?.redFighterName).toBe('Ada Lovelace');
  });

  it('badges a forced rematch publicly', async () => {
    // Decision 16: a fighter asked to replay an opponent can see that no legal
    // alternative existed, rather than assume the draw was fixed.
    const { service } = build({
      swiss_rounds: {
        rows: [
          swissRound({
            id: 'sr1',
            pairing_meta_json: {
              warnings: [{ code: 'forced-rematch', registrationIds: ['r1', 'r2'] }],
              manualAdjustments: [{ kind: 'swap' }],
            },
          }),
        ],
      },
    });

    const rounds = await service.getRounds('t1');

    expect(rounds.rounds[0]).toMatchObject({
      warnings: [{ code: 'forced-rematch', registrationIds: ['r1', 'r2'] }],
      manuallyAdjusted: true,
    });
  });

  it('does not badge a round nobody has touched', async () => {
    const { service } = build();

    const rounds = await service.getRounds('t1');

    expect(rounds.rounds[0]?.manuallyAdjusted).toBe(false);
  });
});
