import { describe, expect, it } from 'vitest';
import { uncompleteConfirmCopy, type UncompletePreflight } from './uncomplete-confirm-copy';

/**
 * The copy has more to be wrong about than the void copy that preceded it,
 * because the destructive case throws away bouts that were actually fought. Each
 * test pins one thing the organiser must be told AND one thing they must never
 * be told, because a reassuring sentence in the wrong branch is the whole defect
 * class here.
 */

const preflight = (over: Partial<UncompletePreflight> = {}): UncompletePreflight => ({
  affected: [],
  foughtCount: 0,
  blocked: false,
  canDiscard: false,
  frozen: false,
  ...over,
});

const bout = (hasBeenFought: boolean) => ({
  label: '7',
  redName: 'A',
  blueName: 'B',
  round: 2,
  status: hasBeenFought ? 'completed' : 'scheduled',
  hasBeenFought,
  locked: false,
});

const keys = (copy: { body: Array<{ key: string }> }) => copy.body.map((line) => line.key);

describe('uncompleteConfirmCopy', () => {
  it('says nothing is affected when the match feeds nothing', () => {
    const copy = uncompleteConfirmCopy(preflight());

    expect(keys(copy)).toEqual(['organizer.matchDetail.uncompleteBodyEmptiesNone']);
    expect(copy.action).toBe('proceed');
    expect(copy.hint).toBeNull();
  });

  it('counts the emptied bouts and promises they refill, when none was fought', () => {
    const copy = uncompleteConfirmCopy(
      preflight({ affected: [bout(false), bout(false)], blocked: false }),
    );

    expect(keys(copy)).toEqual([
      'organizer.matchDetail.uncompleteBodyEmptiesMany',
      'organizer.matchDetail.uncompleteBodyRefills',
    ]);
    expect(copy.body[0]?.values).toEqual({ count: 2 });
    // Nothing is discarded here, so the sentence that says so must not appear.
    expect(keys(copy)).not.toContain('organizer.matchDetail.uncompleteBodyDiscardsMany');
    expect(copy.action).toBe('proceed');
  });

  it('uses the singular key for a single emptied bout', () => {
    // `t()` has no plural engine, so "the 1 later bouts" is what the separate
    // key exists to prevent.
    const copy = uncompleteConfirmCopy(preflight({ affected: [bout(false)] }));

    expect(copy.body[0]).toEqual({ key: 'organizer.matchDetail.uncompleteBodyEmptiesOne' });
  });

  it('tells an organiser exactly what a fought bout costs, and asks for the tick', () => {
    const copy = uncompleteConfirmCopy(
      preflight({ affected: [bout(true)], foughtCount: 1, blocked: true, canDiscard: true }),
    );

    expect(keys(copy)).toEqual([
      'organizer.matchDetail.uncompleteBodyDiscardsOne',
      'organizer.matchDetail.uncompleteBodyBackOnSchedule',
      'organizer.matchDetail.uncompleteBodyRefills',
    ]);
    expect(copy.action).toBe('acknowledge');
  });

  it('refuses, and points at an organiser, for an actor who may not discard', () => {
    const copy = uncompleteConfirmCopy(
      preflight({
        affected: [bout(true), bout(true)],
        foughtCount: 2,
        blocked: true,
        canDiscard: false,
      }),
    );

    expect(keys(copy)).toEqual([
      'organizer.matchDetail.uncompleteBodyDiscardsMany',
      'organizer.matchDetail.uncompleteBodyAskOrganiser',
    ]);
    expect(copy.action).toBe('refused');
    // The one sentence it must NEVER carry here: nothing is going back on the
    // schedule, because this actor cannot make it happen.
    expect(keys(copy)).not.toContain('organizer.matchDetail.uncompleteBodyBackOnSchedule');
  });

  it('surfaces the discard sentence as the panel hint, readable without the dialog', () => {
    // The panel is what an organiser looks at before deciding to click at all.
    expect(
      uncompleteConfirmCopy(preflight({ foughtCount: 3, blocked: true, canDiscard: true })).hint,
    ).toEqual({ key: 'organizer.matchDetail.uncompleteBodyDiscardsMany', values: { count: 3 } });
  });

  it('a frozen event refuses outright, whatever else the pre-flight found', () => {
    // Offering the tick would be a dead end: the write is refused server-side
    // regardless, so the dialog must not imply the organiser can proceed.
    const copy = uncompleteConfirmCopy(
      preflight({ frozen: true, blocked: true, foughtCount: 2, canDiscard: true }),
    );

    expect(keys(copy)).toEqual(['organizer.matchDetail.uncompleteBodyFrozen']);
    expect(copy.action).toBe('refused');
  });

  it('degrades to the generic sentence when the pre-flight could not be read', () => {
    // A panel that cannot load must not claim there is nothing downstream —
    // that is the same shape of lie the void copy exists to remove.
    for (const missing of [undefined, null]) {
      const copy = uncompleteConfirmCopy(missing);
      expect(keys(copy)).toEqual(['organizer.matchDetail.uncompleteBodyEmptiesNone']);
      expect(copy.hint).toBeNull();
    }
  });

  it('says the forfeit stops counting, because an F vanishing silently is the bug', () => {
    const copy = uncompleteConfirmCopy(preflight({ forfeitsToVoid: 1 }));

    expect(keys(copy)).toContain('organizer.matchDetail.uncompleteBodyForfeitVoided');
    // On the panel too — the standings change is the consequence an organiser
    // is least likely to predict from the word 'undo'.
    expect(copy.hint?.key).toBe('organizer.matchDetail.uncompleteBodyForfeitVoided');
    expect(copy.action).toBe('proceed');
  });

  it('refuses, and names the other screen, when the forfeit withdrew the fighter', () => {
    // Ranked above the fought dependents: the API refuses whatever is ticked, so
    // offering the tick would be the lie this module exists to remove.
    const copy = uncompleteConfirmCopy(
      preflight({ forfeitBlocked: true, blocked: true, foughtCount: 1, canDiscard: true }),
    );

    expect(keys(copy)).toEqual(['organizer.matchDetail.uncompleteBodyForfeitBlocked']);
    expect(copy.action).toBe('refused');
    expect(keys(copy)).not.toContain('organizer.matchDetail.uncompleteBodyDiscardsOne');
  });

  it('warns that a reserve substitution is NOT undone', () => {
    const copy = uncompleteConfirmCopy(
      preflight({ forfeitsToVoid: 1, forfeitReplacedFighter: true }),
    );

    expect(keys(copy)).toContain('organizer.matchDetail.uncompleteBodyForfeitReplacement');
  });

  it('keeps the forfeit sentence on the destructive branch too', () => {
    const copy = uncompleteConfirmCopy(
      preflight({
        affected: [bout(true)],
        blocked: true,
        foughtCount: 1,
        canDiscard: true,
        forfeitsToVoid: 1,
      }),
    );

    expect(copy.action).toBe('acknowledge');
    expect(keys(copy)).toContain('organizer.matchDetail.uncompleteBodyForfeitVoided');
    // The discard sentence still leads — it is the one that loses fought bouts.
    expect(copy.hint?.key).toBe('organizer.matchDetail.uncompleteBodyDiscardsOne');
  });
});
