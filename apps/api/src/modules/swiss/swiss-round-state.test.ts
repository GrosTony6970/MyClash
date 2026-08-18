import { describe, expect, it } from 'vitest';
import { mockSupabase, writesTo } from '../../common/testing/supabase-chain';
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

/** Every row written to `swiss_rounds`, with the filters that scoped it. */
const updateCalls = (supabase: Parameters<typeof writesTo>[0]) =>
  writesTo(supabase, 'swiss_rounds').map((write) => write.row);

/**
 * The projection has to be computed on the state the caller is ABOUT to create.
 *
 * `MatchCompletionService.onMatchUncompleted` runs before its caller writes the
 * matches row — that ordering is what makes a refusal leave nothing half-done —
 * so at the moment it asks for this recompute, the bout is still `completed` in
 * the database. Reading it plainly derives `completed`, finds nothing changed,
 * and writes nothing: an inverse that ships green and does nothing at all.
 */
describe('SwissRoundStateService.refresh', () => {
  /**
   * The round under test, plus a second one of the same phase.
   *
   * The decoy is what makes the id scope decidable: without it the read
   * returns the only row in the table whether or not it asked for one, and the
   * update rewrites the same single row whatever it was scoped to.
   */
  const round = (matches: Array<{ id: string; status: string }>, status = 'completed') => ({
    swiss_rounds: {
      rows: [
        { id: 'round-1', phase_id: 'p1', status, matches },
        { id: 'round-2', phase_id: 'p1', status: 'pending', matches: [] },
      ],
    },
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

  it('writes the new status to the round it read, and to no other', async () => {
    // The table holds a second round of the same phase. An unscoped update
    // would drag it to the same status as this one.
    const supabase = mockSupabase(
      round([
        { id: 'm1', status: 'completed' },
        { id: 'm2', status: 'completed' },
      ]),
    );

    await new SwissRoundStateService(supabase as unknown as SupabaseService).refresh(
      'round-1',
      'm1',
    );

    expect(writesTo(supabase, 'swiss_rounds')[0]?.filters).toEqual(
      expect.arrayContaining([{ method: 'eq', args: ['id', 'round-1'] }]),
    );
  });
});

describe('SwissRoundStateService.isEditable', () => {
  const rounds = mockSupabase({
    swiss_rounds: {
      rows: [
        { id: 'round-1', phase_id: 'p1', status: 'pending' },
        { id: 'round-2', phase_id: 'p1', status: 'running' },
      ],
    },
  });

  it('is true only while the round is still pending', async () => {
    // Decision 3's override window, asked as a question: a pending round is
    // open to pairing edits, and the first fighter on the piste closes it.
    const service = new SwissRoundStateService(rounds as unknown as SupabaseService);

    await expect(service.isEditable('round-1')).resolves.toBe(true);
    await expect(service.isEditable('round-2')).resolves.toBe(false);
  });

  it('is false for a round that does not exist', async () => {
    const service = new SwissRoundStateService(rounds as unknown as SupabaseService);

    await expect(service.isEditable('round-gone')).resolves.toBe(false);
  });
});
