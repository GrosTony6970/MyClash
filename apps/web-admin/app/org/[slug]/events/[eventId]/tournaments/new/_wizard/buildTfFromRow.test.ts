import { describe, expect, it } from 'vitest';
import { buildTfFromRow, type RulesetConfigTF, TF_DEFAULTS } from './buildTfFromRow';

describe('buildTfFromRow', () => {
  it('returns defaults when the row is empty', () => {
    expect(buildTfFromRow({}, TF_DEFAULTS)).toEqual(TF_DEFAULTS);
  });

  it('overlays known fields from the row onto the defaults', () => {
    const result = buildTfFromRow(
      {
        winBonus: 5,
        targetValues: { deepTarget: 3, shallowTarget: 2 },
        tournamentPolicy: {
          forfeitDrawsCount: true,
          forfeitFighterBefore1stMatch: true,
          disqualifyAfter: 4,
        },
      },
      TF_DEFAULTS,
    );
    expect(result).toEqual({
      winBonus: 5,
      targetValues: { deepTarget: 3, shallowTarget: 2 },
      tournamentPolicy: {
        forfeitDrawsCount: true,
        forfeitFighterBefore1stMatch: true,
        disqualifyAfter: 4,
      },
    });
  });

  it('discards unknown keys at every depth (this is the bug at hand)', () => {
    // Reproduces the live failure: the persisted ruleset engine stores a
    // `forfeitPolicy.reasons.{injury,voluntary,…}` blob under the old colliding
    // key. With the wizard rename in place we read `tournamentPolicy`, but the
    // helper must still tolerate junk from a legacy row.
    const result = buildTfFromRow(
      {
        winBonus: 4,
        somethingNew: 'leak',
        targetValues: {
          deepTarget: 2,
          shallowTarget: 1,
          legacyBonus: 7,
        },
        tournamentPolicy: {
          forfeitDrawsCount: false,
          forfeitFighterBefore1stMatch: false,
          disqualifyAfter: 2,
          reasons: { injury: { scorePolicy: 'keep_current' } },
        },
      } as unknown as Partial<RulesetConfigTF> & Record<string, unknown>,
      TF_DEFAULTS,
    );

    const json = JSON.stringify(result);
    expect(json).not.toContain('somethingNew');
    expect(json).not.toContain('legacyBonus');
    expect(json).not.toContain('reasons');
    expect(json).not.toContain('injury');

    expect(Object.keys(result).sort()).toEqual(
      ['targetValues', 'tournamentPolicy', 'winBonus'].sort(),
    );
    expect(Object.keys(result.targetValues).sort()).toEqual(['deepTarget', 'shallowTarget']);
    expect(Object.keys(result.tournamentPolicy).sort()).toEqual(
      ['disqualifyAfter', 'forfeitDrawsCount', 'forfeitFighterBefore1stMatch'].sort(),
    );
  });

  it('falls back to defaults for partially-present nested objects', () => {
    const result = buildTfFromRow(
      { targetValues: { deepTarget: 5 } as RulesetConfigTF['targetValues'] },
      TF_DEFAULTS,
    );
    expect(result.targetValues.deepTarget).toBe(5);
    expect(result.targetValues.shallowTarget).toBe(TF_DEFAULTS.targetValues.shallowTarget);
  });
});
