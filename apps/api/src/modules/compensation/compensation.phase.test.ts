import { describe, expect, it } from 'vitest';
import { compensationPhaseFor } from './compensation.service';

/**
 * The rate a completed match is paid at comes from its PHASE TYPE.
 *
 * It used to be inferred from `lice_id` presence — on a piste meant "bracket",
 * off one meant "pool". That only ever worked because match-scoped referee
 * assignments came exclusively from the bracket loader. Swiss writes
 * match-scoped rows too, so a scheduled Swiss bout would have been paid at the
 * bracket rate and an unscheduled one at the pool rate, never at the Swiss
 * rate migration 0164 seeded.
 */
describe('compensationPhaseFor', () => {
  it('pays a Swiss bout at the Swiss rate, scheduled or not', () => {
    expect(compensationPhaseFor('swiss', 'SW-R1-M1')).toBe('swiss');
    expect(compensationPhaseFor('swiss', null)).toBe('swiss');
  });

  it('pays a pool bout at the pool rate', () => {
    expect(compensationPhaseFor('pool', 'LSW-P1-M3')).toBe('pool');
  });

  it('splits an elimination phase into bracket and finals on the label', () => {
    expect(compensationPhaseFor('single_elim', 'QF1')).toBe('bracket');
    expect(compensationPhaseFor('single_elim', 'F')).toBe('finals');
    expect(compensationPhaseFor('single_elim', 'BRONZE')).toBe('finals');
    expect(compensationPhaseFor('double_elim', 'GOLD')).toBe('finals');
    expect(compensationPhaseFor('single_elim', null)).toBe('bracket');
  });

  it('returns null for an unknown or missing phase rather than guessing', () => {
    // Guessing is what produced the bug: the caller skips the row instead.
    expect(compensationPhaseFor(null, 'F')).toBeNull();
    expect(compensationPhaseFor(undefined, null)).toBeNull();
    expect(compensationPhaseFor('some_future_format', 'F')).toBeNull();
  });

  it('never reads a finals label out of a Swiss round', () => {
    // A Swiss round label can contain 'F' via a fighter-supplied string; the
    // phase type decides, not the text.
    expect(compensationPhaseFor('swiss', 'FINAL ROUND')).toBe('swiss');
  });
});
