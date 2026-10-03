import { describe, expect, it } from 'vitest';
import { mockSupabase } from '../../common/testing/supabase-chain';
import { BracketAdvanceService } from './bracket-advance.service';

/**
 * Ruling 230: a caller that must not MAKE a second grand final asks first.
 * Advancing from a grand final the losers' side won creates that bout.
 *
 * Two winners' rounds, one losers' round: the grand final is round 4.
 */
const CONFIG = { wbRounds: 2, lbRounds: 1, grandFinalReset: true };

function setup(
  over: {
    winner?: string | null;
    round?: number;
    type?: string;
    config?: Record<string, unknown>;
    slotId?: string | null;
  } = {},
) {
  const db = mockSupabase({
    matches: {
      rows: [
        {
          id: 'grand-final',
          bracket_slot_id: over.slotId === undefined ? 'slot-gf' : over.slotId,
          winner_registration_id: over.winner === undefined ? 'from-losers' : over.winner,
          red_registration_id: 'from-winners',
          blue_registration_id: 'from-losers',
        },
        // Another bout of another slot: an unscoped read would answer for it.
        { id: 'other', bracket_slot_id: 'slot-other', winner_registration_id: 'x' },
      ],
    },
    bracket_slots: {
      rows: [
        {
          id: 'slot-gf',
          phase_id: 'phase-1',
          round: over.round ?? 4,
          position: 1,
          registration_a_id: 'from-winners',
          registration_b_id: 'from-losers',
        },
        { id: 'slot-other', phase_id: 'phase-1', round: 1, position: 1 },
      ],
    },
    phases: {
      rows: [
        { id: 'phase-1', type: over.type ?? 'double_elim', config_json: over.config ?? CONFIG },
      ],
    },
  });
  return new BracketAdvanceService(db as never);
}

describe('BracketAdvanceService.asksForGrandFinalReset', () => {
  it('yes: the losers’ side won the grand final of a bracket with a reset', async () => {
    expect(await setup().asksForGrandFinalReset('grand-final')).toBe(true);
  });

  it('no: the winners’ side won it, which ends the bracket', async () => {
    expect(await setup({ winner: 'from-winners' }).asksForGrandFinalReset('grand-final')).toBe(
      false,
    );
  });

  it('yes: a grand final with no winner has not ended the bracket either', async () => {
    expect(await setup({ winner: null }).asksForGrandFinalReset('grand-final')).toBe(true);
  });

  it.each<[string, Parameters<typeof setup>[0]]>([
    ['another round of the bracket', { round: 3 }],
    ['a bracket with no reset', { config: { ...CONFIG, grandFinalReset: false } }],
    ['a single elimination', { type: 'single_elim' }],
    ['a bout of no bracket', { slotId: null }],
  ])('no: %s', async (_name, over) => {
    expect(await setup(over).asksForGrandFinalReset('grand-final')).toBe(false);
  });
});
