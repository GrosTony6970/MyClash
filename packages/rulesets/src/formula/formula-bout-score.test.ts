import { describe, expect, it } from 'vitest';
import type { Exchange } from '../types';
import { createFormulaRuleset } from './ruleset';
import { DEFAULT_MATCH_FORMAT_CONFIG, EDITION_2026_10 } from '../match-format';
import { DEFAULT_FORMULA_CONSTANTS } from './types';

/**
 * A club formula ruleset's server bout score counts the value of the button the
 * referee pressed, and nets an afterblow by the Tournament's afterblow mode
 * (ruling 2026-11-27). It used to flatten every hit to 1 and drop the afterblow,
 * while the tablet added the button's value.
 */
describe('createFormulaRuleset — the bout score counts button values', () => {
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
    { hasAfterblow: true },
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
  const deep = (id: string) => exchange({ id, firstStrikeValue: 2 });

  it('counts a deep hit worth 2 as 2', () => {
    const score = ruleset.computeMatchScore(poolMatch, [deep('e1')], 'full', {});
    expect(score).toMatchObject({ redScore: 2, blueScore: 0 });
  });

  it('nets an afterblow by the mode it is handed', () => {
    const afterblow = exchange({ type: 'afterblow', firstStrikeValue: 2, afterblowValue: 1 });
    expect(ruleset.computeMatchScore(poolMatch, [afterblow], 'full', {})).toMatchObject({
      redScore: 2,
      blueScore: 1,
    });
    expect(ruleset.computeMatchScore(poolMatch, [afterblow], 'deductive', {})).toMatchObject({
      redScore: 1,
      blueScore: 0,
    });
  });

  it('ends the bout when the points reach the cap, not the number of hits', () => {
    const config = { matchFormat: { ...DEFAULT_MATCH_FORMAT_CONFIG, pointCap: 4 } };
    const score = ruleset.computeMatchScore(poolMatch, [deep('e1'), deep('e2')], 'full', config);
    expect(score).toMatchObject({ redScore: 4 });
    expect(ruleset.isMatchOver(poolMatch, score, config).isOver).toBe(true);
  });
});
