import { describe, expect, it } from 'vitest';
import { mockSupabase } from '../../common/testing/supabase-chain';
import type { SupabaseService } from '../supabase/supabase.service';
import { deriveRoundStatus, SwissRoundStateService } from './swiss-round-state.service';

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

/**
 * The projection has to be computed on the state the caller is ABOUT to create.
 *
 * `MatchCompletionService.onMatchUncompleted` runs before its caller writes the
 * matches row — that ordering is what makes a refusal leave nothing half-done —
 * so at the moment it asks for this recompute, the bout is still `completed` in
 * the database. Reading it plainly derives `completed`, finds nothing changed,
 * and writes nothing: an inverse that ships green and does nothing at all.
 */
/** Every row written across every chain the double handed out. */
const updateCalls = (supabase: { from: { mock: { results: Array<{ value: unknown }> } } }) =>
  supabase.from.mock.results.flatMap((result) =>
    ((result.value as { update: { mock: { calls: unknown[][] } } }).update.mock.calls ?? []).map(
      (call) => call[0],
    ),
  );

describe('SwissRoundStateService.refresh', () => {
  const round = (matches: Array<{ id: string; status: string }>, status = 'completed') => ({
    swiss_rounds: { data: { id: 'round-1', status, matches }, error: null },
  });

  it('re-opens the round when the named bout is projected as unplayed', async () => {
    const supabase = mockSupabase(
      round([
        { id: 'm1', status: 'completed' },
        { id: 'm2', status: 'completed' },
      ]),
    );

    const next = await new SwissRoundStateService(supabase as unknown as SupabaseService).refresh(
      'round-1',
      'm1',
    );

    expect(next).toBe('running');
    // A fresh chain per from() call, so the write is on the second one.
    expect(updateCalls(supabase)).toEqual([{ status: 'running' }]);
  });

  it('writes NOTHING without the projection — the defect this parameter exists for', async () => {
    const supabase = mockSupabase(
      round([
        { id: 'm1', status: 'completed' },
        { id: 'm2', status: 'completed' },
      ]),
    );

    const next = await new SwissRoundStateService(supabase as unknown as SupabaseService).refresh(
      'round-1',
    );

    expect(next).toBe('completed');
    expect(updateCalls(supabase)).toEqual([]);
  });

  it('leaves the round completed when the projected bout is not in it', async () => {
    // A match id from another round must not silently re-open this one.
    const supabase = mockSupabase(
      round([
        { id: 'm1', status: 'completed' },
        { id: 'm2', status: 'completed' },
      ]),
    );

    const next = await new SwissRoundStateService(supabase as unknown as SupabaseService).refresh(
      'round-1',
      'match-from-elsewhere',
    );

    expect(next).toBe('completed');
  });
});
