import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MatchCompletionService } from './match-completion.service';
import { dependentClosure } from './bracket-dependents';
import type * as BracketDependents from './bracket-dependents';

/**
 * Rulings 225 to 230: what a correction on a finished bout has to know, and what
 * the bracket is told once the bout names another result.
 *
 * `dependentClosure` is doubled: its own walk is `bracket-dependents.test.ts`.
 * What is owned here is which of its answers counts as "a later bout was fought".
 */
vi.mock('./bracket-dependents', async (original) => ({
  ...(await original<typeof BracketDependents>()),
  dependentClosure: vi.fn(),
}));

const dependents = vi.mocked(dependentClosure);
const bout = (hasBeenFought: boolean) => ({ matchId: 'later', hasBeenFought }) as never;

function setup(over: { eventOver?: boolean; roundsAhead?: unknown[] } = {}) {
  const frozenResults = { isEventOver: vi.fn().mockResolvedValue(over.eventOver ?? false) };
  const order: string[] = [];
  const bracketAdvance = {
    clearDownstreamOf: vi.fn(async () => void order.push('clear')),
    asksForGrandFinalReset: vi.fn().mockResolvedValue(false),
    onMatchCompleted: vi.fn(async () => void order.push('advance')),
  };
  const swissAdvance = {
    roundsAhead: vi.fn().mockResolvedValue(over.roundsAhead ?? []),
    onMatchCompleted: vi.fn().mockResolvedValue(undefined),
  };
  const service = new MatchCompletionService(
    { service: {} } as never,
    frozenResults as never,
    bracketAdvance as never,
    undefined,
    swissAdvance as never,
  );
  return { service, frozenResults, bracketAdvance, swissAdvance, order };
}

beforeEach(() => {
  dependents.mockReset();
  dependents.mockResolvedValue([]);
});

describe('MatchCompletionService.resultChangeContext', () => {
  it('a running Event that feeds nothing: the bout can still go back to its referee', async () => {
    const { service, frozenResults } = setup();

    expect(await service.resultChangeContext('m1')).toEqual({
      eventOver: false,
      staysFinished: false,
      laterBoutFought: false,
    });
    expect(frozenResults.isEventOver).toHaveBeenCalledWith('m1');
    expect(dependents).toHaveBeenCalledWith(expect.anything(), 'm1');
  });

  it('an over Event: the bout stays finished', async () => {
    const { service, swissAdvance } = setup({ eventOver: true });

    expect(await service.resultChangeContext('m1')).toMatchObject({
      eventOver: true,
      staysFinished: true,
    });
    // Already decided: the Swiss read would change nothing.
    expect(swissAdvance.roundsAhead).not.toHaveBeenCalled();
  });

  it('a later Swiss round drawn: the bout stays finished, and feeds nothing (228)', async () => {
    const { service, swissAdvance } = setup({ roundsAhead: [{ roundNumber: 3 }] });

    expect(await service.resultChangeContext('m1')).toEqual({
      eventOver: false,
      staysFinished: true,
      laterBoutFought: false,
    });
    expect(swissAdvance.roundsAhead).toHaveBeenCalledWith('m1');
  });

  it('a fed bout that was fought counts; one that only waits does not', async () => {
    const { service } = setup();

    dependents.mockResolvedValueOnce([bout(false)]);
    expect((await service.resultChangeContext('m1')).laterBoutFought).toBe(false);

    dependents.mockResolvedValueOnce([bout(false), bout(true)]);
    expect((await service.resultChangeContext('m1')).laterBoutFought).toBe(true);
  });

  it('a read that fails is not an answer', async () => {
    const { service, frozenResults } = setup();
    frozenResults.isEventOver.mockRejectedValueOnce(new Error('read failed'));

    await expect(service.resultChangeContext('m1')).rejects.toThrow('read failed');
  });
});

describe('MatchCompletionService.onResultChanged', () => {
  it('clears what the bout fed, then advances its new result', async () => {
    const { service, bracketAdvance, order } = setup();

    await service.onResultChanged('m1', false);

    expect(bracketAdvance.clearDownstreamOf).toHaveBeenCalledWith('m1');
    expect(bracketAdvance.onMatchCompleted).toHaveBeenCalledWith('m1');
    expect(order).toEqual(['clear', 'advance']);
  });

  it('on an over Event, makes no second grand final (ruling 230)', async () => {
    const { service, bracketAdvance } = setup();
    bracketAdvance.asksForGrandFinalReset.mockResolvedValue(true);

    await service.onResultChanged('m1', true);

    expect(bracketAdvance.asksForGrandFinalReset).toHaveBeenCalledWith('m1');
    expect(bracketAdvance.clearDownstreamOf).toHaveBeenCalledWith('m1');
    expect(bracketAdvance.onMatchCompleted).not.toHaveBeenCalled();
  });

  it('on a running Event the second grand final is made: somebody can fight it', async () => {
    const { service, bracketAdvance } = setup();
    bracketAdvance.asksForGrandFinalReset.mockResolvedValue(true);

    await service.onResultChanged('m1', false);

    expect(bracketAdvance.onMatchCompleted).toHaveBeenCalledWith('m1');
  });

  it('on an over Event every other bout is advanced as usual', async () => {
    const { service, bracketAdvance } = setup();

    await service.onResultChanged('m1', true);

    expect(bracketAdvance.onMatchCompleted).toHaveBeenCalledWith('m1');
  });

  it('never throws, and does not advance into sides it could not clear', async () => {
    const { service, bracketAdvance } = setup();
    bracketAdvance.clearDownstreamOf.mockRejectedValueOnce(new Error('slot write failed'));

    await expect(service.onResultChanged('m1', false)).resolves.toBeUndefined();
    expect(bracketAdvance.onMatchCompleted).not.toHaveBeenCalled();
  });
});
