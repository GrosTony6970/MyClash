import { describe, it, expect, vi } from 'vitest';
import { MatchCompletionService } from './match-completion.service';

/**
 * Behavioural tests for the single owner of "a match just completed".
 *
 * These exist because the side effects were previously owned by call sites and
 * went missing twice, silently: first bracket advancement (so a bracket scored
 * on the pad never advanced), then the pool auto-populate sitting on the very
 * next line (so scoring the last pool match left the bracket empty).
 *
 * Asserted on BEHAVIOUR, not on source text. A text guard was tried and proved
 * vacuous — `populateBracket` still appeared in the docstring and in the private
 * method's own name long after the actual call had been deleted.
 */

/** Supabase double returning one match row with its phase embedded. */
function supabaseFor(phase: { type: string; tournament_id: string } | null) {
  const chain: Record<string, unknown> = {};
  Object.assign(chain, {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    maybeSingle: vi.fn().mockResolvedValue({ data: phase ? { phases: phase } : null, error: null }),
  });
  return { service: { from: vi.fn(() => chain) } };
}

const POOL = { type: 'pool', tournament_id: 't1' };
const BRACKET = { type: 'single_elim', tournament_id: 't1' };

describe('MatchCompletionService.onMatchCompleted', () => {
  it('advances the bracket', async () => {
    const bracketAdvance = { onMatchCompleted: vi.fn().mockResolvedValue(undefined) };
    const phases = { populateBracket: vi.fn().mockResolvedValue(undefined) };

    await new MatchCompletionService(
      supabaseFor(BRACKET) as never,
      bracketAdvance as never,
      phases as never,
    ).onMatchCompleted('m1');

    expect(bracketAdvance.onMatchCompleted).toHaveBeenCalledWith('m1');
  });

  /** The regression: a completed POOL match must try to seed the bracket. */
  it('attempts the pool auto-populate after a pool match', async () => {
    const bracketAdvance = { onMatchCompleted: vi.fn().mockResolvedValue(undefined) };
    const phases = { populateBracket: vi.fn().mockResolvedValue(undefined) };

    await new MatchCompletionService(
      supabaseFor(POOL) as never,
      bracketAdvance as never,
      phases as never,
    ).onMatchCompleted('m1');

    // silentIfGateNotMet: populate itself decides whether the pools are done.
    expect(phases.populateBracket).toHaveBeenCalledWith('t1', {}, 'system', {
      silentIfGateNotMet: true,
    });
  });

  it('does not auto-populate after a bracket match', async () => {
    const bracketAdvance = { onMatchCompleted: vi.fn().mockResolvedValue(undefined) };
    const phases = { populateBracket: vi.fn().mockResolvedValue(undefined) };

    await new MatchCompletionService(
      supabaseFor(BRACKET) as never,
      bracketAdvance as never,
      phases as never,
    ).onMatchCompleted('m1');

    expect(phases.populateBracket).not.toHaveBeenCalled();
  });

  /**
   * A side effect must never fail the write that triggered it — an exchange, a
   * clock action, a status change. Both halves are independently guarded, so a
   * throwing advance still lets the populate run.
   */
  it('never throws, and a failing advance still lets the populate run', async () => {
    const bracketAdvance = { onMatchCompleted: vi.fn().mockRejectedValue(new Error('boom')) };
    const phases = { populateBracket: vi.fn().mockRejectedValue(new Error('nope')) };

    await expect(
      new MatchCompletionService(
        supabaseFor(POOL) as never,
        bracketAdvance as never,
        phases as never,
      ).onMatchCompleted('m1'),
    ).resolves.toBeUndefined();

    expect(bracketAdvance.onMatchCompleted).toHaveBeenCalled();
    expect(phases.populateBracket).toHaveBeenCalled();
  });

  it('is inert when its optional dependencies are not wired', async () => {
    await expect(
      new MatchCompletionService(supabaseFor(POOL) as never).onMatchCompleted('m1'),
    ).resolves.toBeUndefined();
  });
});
