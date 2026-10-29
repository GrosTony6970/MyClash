import { describe, expect, it } from 'vitest';
import { FORFEIT_RULE_LEAF_PATHS } from '@myclash/types';
import {
  FFAMHE_FORFEIT_RULES,
  mergeForfeitRules,
  type ForfeitChanges,
  type ForfeitRulesInForce,
} from '@myclash/types/forfeit-rules';
import { forfeitRulesChanges } from './forfeit-rules-diff';
import { lockedChanges } from './scoring-diff';

/** A club ruleset's rules in force: "disqualify after" off (ruling 67). */
const RULESET: ForfeitRulesInForce = {
  ...FFAMHE_FORFEIT_RULES,
  disqualifyAfter: 'off',
  firstBlackCard: 'match',
  secondBlackCard: 'tournament',
};

/** The diff of a save from `before` to `after`, both the Tournament's stored changes. */
const diffOf = (before: ForfeitChanges | null, after: ForfeitChanges | null) =>
  forfeitRulesChanges(
    mergeForfeitRules(RULESET, before),
    mergeForfeitRules(RULESET, after),
    before,
    after,
  );

describe('forfeitRulesChanges: the rules in force', () => {
  it('names "disqualify after" off → 2 from the ruleset’s value, not from the stored change', () => {
    expect(diffOf(null, { disqualifyAfter: 2 })).toEqual([
      { path: 'forfeitRules.disqualifyAfter', before: 'off', after: 2 },
    ]);
  });

  it('names each leaf that moved, in the list’s order', () => {
    const changes = diffOf(
      { reasons: { injury: { fighter: 'withdrawn' } } },
      {
        secondBlackCard: 'none',
        reasons: { injury: { fighter: 'disqualified', opponentScore: 9 } },
      },
    );
    expect(changes).toEqual([
      { path: 'forfeitRules.secondBlackCard', before: 'tournament', after: 'none' },
      { path: 'forfeitRules.reasons.injury.opponentScore', before: 6, after: 9 },
      { path: 'forfeitRules.reasons.injury.fighter', before: 'withdrawn', after: 'disqualified' },
    ]);
  });

  it('names nothing when the same changes come back in another key order', () => {
    const stored = { reasons: { injury: { fighter: 'withdrawn', opponentScore: 9 } } } as const;
    const reordered = { reasons: { injury: { opponentScore: 9, fighter: 'withdrawn' } } } as const;
    expect(diffOf(stored, reordered)).toEqual([]);
  });
});

describe('forfeitRulesChanges: what is stored (ruling 147)', () => {
  it('names a stored change equal to the ruleset’s value as set, the value in force the same', () => {
    expect(diffOf(null, { reasons: { voluntary: { fighter: 'asks' } } })).toEqual([
      {
        path: 'forfeitRules.reasons.voluntary.fighter',
        before: 'asks',
        after: 'asks',
        stored: 'set',
      },
    ]);
  });

  it('names a Reset of a change equal to the ruleset’s value as reset', () => {
    expect(diffOf({ blackCardOpponentScore: 6 }, null)).toEqual([
      { path: 'forfeitRules.blackCardOpponentScore', before: 6, after: 6, stored: 'reset' },
    ]);
  });

  it('marks no entry stored when the value in force moved', () => {
    const [entry] = diffOf({ disqualifyAfter: 3 }, null);
    expect(entry).toEqual({ path: 'forfeitRules.disqualifyAfter', before: 3, after: 'off' });
  });
});

describe('forfeitRulesChanges: fail closed', () => {
  it('names a restored `{}` deep down as another forfeit rule, with no value', () => {
    const restored = { reasons: { injury: {} } } as unknown as ForfeitChanges;
    expect(diffOf(restored, null)).toEqual([
      { path: 'forfeitRules.unknown', before: null, after: null },
    ]);
  });

  it('names a leaf of the rules in force the list does not hold, once, with no value', () => {
    const before = { ...RULESET, newRule: 1 } as unknown as ForfeitRulesInForce;
    const after = { ...RULESET, newRule: 2, otherRule: true } as unknown as ForfeitRulesInForce;
    expect(forfeitRulesChanges(before, after, null, null)).toEqual([
      { path: 'forfeitRules.unknown', before: null, after: null },
    ]);
  });

  it('lists every leaf of the rules in force, so nothing in force is unlisted today', () => {
    const leaves: string[] = [];
    const walk = (value: unknown, prefix: string) => {
      if (typeof value === 'object' && value !== null) {
        for (const [key, child] of Object.entries(value)) walk(child, `${prefix}.${key}`);
      } else leaves.push(prefix);
    };
    walk(RULESET, 'forfeitRules');
    expect([...leaves].sort()).toEqual([...FORFEIT_RULE_LEAF_PATHS].sort());
  });
});

describe('a forfeit entry locks on the Tournament’s clock', () => {
  const entry = { path: 'forfeitRules.disqualifyAfter' as const, before: 'off', after: 2 };

  it('locks once the Tournament runs or any bout started, and not before', () => {
    const running = { running: true, startedFormatPhases: new Set<never>() };
    const finals = { running: false, startedFormatPhases: new Set(['finals'] as const) };
    const none = { running: false, startedFormatPhases: new Set<never>() };
    expect(lockedChanges([entry], running)[0]!.locked).toBe(true);
    expect(lockedChanges([entry], finals)[0]!.locked).toBe(true);
    expect(lockedChanges([entry], none)[0]!.locked).toBe(false);
  });
});
