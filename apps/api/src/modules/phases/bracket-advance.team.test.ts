import { describe, expect, it } from 'vitest';
import {
  mockSupabase,
  scopedTo,
  selectsFor,
  writesTo,
  type SupabaseRow,
} from '../../common/testing/supabase-chain';
import { BracketAdvanceService } from './bracket-advance.service';

/**
 * A team bracket's byes and an operator's slot edit write a side by its kind: a team goes into
 * the team column, and the Registration column of that side is cleared (`seatColumns`, 0282).
 */

const PHASE: SupabaseRow = {
  id: 'bracket-1',
  type: 'single_elim',
  config_json: {},
  tournaments: { entrant_kind: 'team' },
};
const slot = (id: string, over: SupabaseRow): SupabaseRow => ({
  id,
  phase_id: 'bracket-1',
  source_a_type: 'seed',
  source_b_type: 'seed',
  source_a_ref: null,
  source_b_ref: null,
  registration_a_id: null,
  registration_b_id: null,
  team_a_id: null,
  team_b_id: null,
  ...over,
});

/** A phase read that did not carry the Tournament's kind. */
const PHASE_WITHOUT_KIND: SupabaseRow = { id: 'bracket-1', type: 'single_elim', config_json: {} };

/**
 * Seed 1 has a bye (R1P1); R1P2 is a bout of two teams, team-2 won it; the bye of R1P3 has no
 * seed placed. R2P1 takes the winners of R1P1 and R1P2.
 */
function setup(over: { phase?: SupabaseRow; r2p1?: SupabaseRow } = {}) {
  const supabase = mockSupabase({
    phases: { rows: [over.phase ?? PHASE] },
    bracket_slots: {
      rows: [
        slot('r1p1', { round: 1, position: 1, source_b_type: 'bye', team_a_id: 'team-1' }),
        slot('r1p2', { round: 1, position: 2, team_a_id: 'team-2', team_b_id: 'team-3' }),
        slot('r1p3', { round: 1, position: 3, source_b_type: 'bye' }),
        slot('r2p1', {
          round: 2,
          position: 1,
          source_a_type: 'winner_of',
          source_a_ref: 'winner of R1P1',
          source_b_type: 'winner_of',
          source_b_ref: 'winner of R1P2',
          ...over.r2p1,
        }),
        slot('r2p2', {
          round: 2,
          position: 2,
          source_a_type: 'winner_of',
          source_a_ref: 'winner of R1P3',
          source_b_type: 'winner_of',
          source_b_ref: 'winner of R1P4',
        }),
      ],
    },
    matches: {
      rows: [
        {
          id: 'm-r1p2',
          bracket_slot_id: 'r1p2',
          status: 'completed',
          red_registration_id: null,
          red_team_id: 'team-2',
          blue_registration_id: null,
          blue_team_id: 'team-3',
          winner_registration_id: null,
          winner_team_id: 'team-2',
        },
        { id: 'm-r2p1', bracket_slot_id: 'r2p1', status: 'scheduled' },
      ],
    },
  });
  return { supabase, service: new BracketAdvanceService(supabase as never) };
}

const slotWritesOf = (supabase: ReturnType<typeof mockSupabase>) =>
  writesTo(supabase, 'bracket_slots').map((write) => [scopedTo(write, 'id'), write.row]);

describe('advanceByeSlots — a team bracket', () => {
  it('advances the seeded team into the team column of the next slot', async () => {
    const { supabase, service } = setup();

    await service.advanceByeSlots('bracket-1');

    const slotWrites = writesTo(supabase, 'bracket_slots');
    expect(slotWrites.map((write) => [scopedTo(write, 'id'), write.row])).toEqual([
      ['r2p1', { registration_a_id: null, team_a_id: 'team-1' }],
    ]);
  });

  it('reads the bye slots with both kinds of seeded side', async () => {
    const { supabase, service } = setup();

    await service.advanceByeSlots('bracket-1');

    expect(selectsFor(supabase.from, 'bracket_slots')[0]).toBe(
      'id, round, position, source_b_type, registration_a_id, team_a_id',
    );
  });

  // Advancement fills a side only while it is empty: a side that holds a team is filled.
  it('leaves a next side that already holds a team as it is', async () => {
    const { supabase, service } = setup({ r2p1: { team_a_id: 'team-earlier' } });

    await service.advanceByeSlots('bracket-1');

    expect(slotWritesOf(supabase)).toEqual([]);
  });

  // Like `matches.create-match-kind.test.ts`: a read with no kind must not pass for individual.
  it('writes no slot when the phase read carries no kind', async () => {
    const { supabase, service } = setup({ phase: PHASE_WITHOUT_KIND });

    await service.advanceByeSlots('bracket-1');

    expect(slotWritesOf(supabase)).toEqual([]);
  });
});

describe('onMatchCompleted — a team bracket', () => {
  it('advances the winning team into the team column of the next slot', async () => {
    const { supabase, service } = setup();

    await service.onMatchCompleted('m-r1p2');

    expect(slotWritesOf(supabase)).toEqual([
      ['r2p1', { registration_b_id: null, team_b_id: 'team-2' }],
    ]);
  });

  it('writes no slot when the phase read carries no kind', async () => {
    const { supabase, service } = setup({ phase: PHASE_WITHOUT_KIND });

    await service.onMatchCompleted('m-r1p2');

    expect(slotWritesOf(supabase)).toEqual([]);
    expect(writesTo(supabase, 'matches')).toEqual([]);
  });
});

describe('overrideSlot — a team side', () => {
  function setup() {
    const supabase = mockSupabase({
      // The slot as it stands after the write; no bout row yet, so nothing has started.
      bracket_slots: {
        rows: [
          slot('s-1', { round: 2, position: 1, source_b_type: 'winner_of', team_a_id: 'team-x' }),
        ],
      },
      matches: { rows: [] },
    });
    return { supabase, service: new BracketAdvanceService(supabase as never) };
  }

  it('writes the team into the team column, and a null side clears both columns', async () => {
    const { supabase, service } = setup();

    await service.overrideSlot('s-1', { kind: 'team', id: 'team-x' }, null);

    expect(writesTo(supabase, 'bracket_slots').map((write) => write.row)).toEqual([
      { registration_a_id: null, team_a_id: 'team-x', registration_b_id: null, team_b_id: null },
    ]);
    expect(selectsFor(supabase.from, 'bracket_slots')[0]).toBe(
      'id, registration_a_id, registration_b_id, team_a_id, team_b_id',
    );
  });

  it('leaves a side it is not sent unchanged', async () => {
    const { supabase, service } = setup();

    await service.overrideSlot('s-1', { kind: 'team', id: 'team-x' }, undefined);

    expect(writesTo(supabase, 'bracket_slots').map((write) => write.row)).toEqual([
      { registration_a_id: null, team_a_id: 'team-x' },
    ]);
  });
});
