import { describe, expect, it } from 'vitest';
import type { Exchange } from '../types';
import { createFormulaRuleset } from './ruleset';
import { EDITION_2026_10 } from '../match-format';
import { DEFAULT_FORMULA_CONSTANTS } from './types';

/**
 * An org-authored ruleset KEEPS the doubles ceiling that `Generic_PointsCap`
 * does not have — the operator's ruling.
 *
 * It used to delegate `isMatchOver` to Generic, which has no `max_doubles`
 * branch, while its scoring zeroed both fighters at the ceiling. The bout then
 * sat at 0-0 and could not be finished by scoring at all.
 */
describe('createFormulaRuleset — the doubles ceiling', () => {
  const ruleset = createFormulaRuleset(
    'org_custom',
    '1.0.0',
    'Org Custom',
    {
      scoreFormula: { type: 'var', name: 'victories' },
      constants: DEFAULT_FORMULA_CONSTANTS,
      tiebreakers: [],
    },
    EDITION_2026_10,
  );
  const poolMatch = {
    id: 'm1',
    redRegistrationId: 'reg-red',
    blueRegistrationId: 'reg-blue',
    rulesetCode: 'org_custom',
    rulesetVersion: '1.0.0',
    status: 'running' as const,
    phaseType: 'pool' as const,
  };
  const exchange = (over: Partial<Exchange>): Exchange => ({
    id: 'e1',
    clientUuid: 'u1',
    matchId: 'm1',
    sequence: 1,
    type: 'clean',
    firstStrikerColor: 'red',
    firstStrikeValue: 1,
    afterblowValue: null,
    noExchangeReason: null,
    voided: false,
    occurredAt: '2026-01-01T00:00:00Z',
    ...over,
  });
  const doubles = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      exchange({
        id: `d${i}`,
        sequence: i + 10,
        type: 'double',
        firstStrikerColor: null,
        firstStrikeValue: null,
      }),
    );

  it('ENDS the bout at the ceiling instead of leaving it stuck at 0-0', () => {
    const exchanges = [exchange({}), ...doubles(4)];
    const score = ruleset.computeMatchScore(poolMatch, exchanges, 'full', {});

    // Scoring still zeroes at the ceiling — that is the rule.
    expect(score).toMatchObject({ redScore: 0, blueScore: 0, doubles: 4 });
    // …and now something ends on it.
    expect(ruleset.isMatchOver(poolMatch, score, {})).toEqual({
      isOver: true,
      reason: 'max_doubles',
    });
  });

  it('keeps the bout open below the ceiling', () => {
    const exchanges = [exchange({}), ...doubles(3)];
    const score = ruleset.computeMatchScore(poolMatch, exchanges, 'full', {});

    expect(score).toMatchObject({ redScore: 1, doubles: 3 });
    expect(ruleset.isMatchOver(poolMatch, score, {}).isOver).toBe(false);
  });

  it('declares that it has the ceiling, unlike Generic_PointsCap', () => {
    expect(ruleset.metadata?.hasMaxDoubles).toBe(true);
  });
});
