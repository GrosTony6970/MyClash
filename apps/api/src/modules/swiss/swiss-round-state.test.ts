import { describe, expect, it } from 'vitest';
import { deriveRoundStatus } from './swiss-round-state.service';

/**
 * `swiss_rounds.status` is a projection of the bouts, not a workflow of its
 * own. That is what implements the override window (decision 3) with no extra
 * state: a `pending` round is editable, and the first fighter to step on the
 * piste closes it.
 */
describe('deriveRoundStatus', () => {
  it('is pending while nothing has started', () => {
    expect(deriveRoundStatus(['scheduled', 'scheduled'])).toBe('pending');
  });

  it('is running as soon as one bout has started', () => {
    expect(deriveRoundStatus(['scheduled', 'running'])).toBe('running');
    expect(deriveRoundStatus(['completed', 'scheduled'])).toBe('running');
    expect(deriveRoundStatus(['paused', 'scheduled'])).toBe('running');
  });

  it('is completed only when every bout has finished', () => {
    expect(deriveRoundStatus(['completed', 'completed'])).toBe('completed');
    expect(deriveRoundStatus(['completed', 'running'])).toBe('running');
  });

  it('treats a voided bout as untouched, not as a start', () => {
    // A voided bout did not happen, so it cannot be what makes the round look
    // started and close the override window.
    expect(deriveRoundStatus(['voided', 'scheduled'])).toBe('pending');
    expect(deriveRoundStatus(['voided', 'voided'])).toBe('pending');
  });

  it('calls an empty round pending, not completed', () => {
    // A freshly created round has no matches yet. Calling it complete would let
    // the phase advance straight past it.
    expect(deriveRoundStatus([])).toBe('pending');
  });

  it('is completed for a full round of byes-only… which cannot happen', () => {
    // Guard on the boundary anyway: a one-fighter field produces a round with
    // no bouts, and `pending` is the answer that keeps it from auto-advancing.
    expect(deriveRoundStatus([])).not.toBe('completed');
  });
});
