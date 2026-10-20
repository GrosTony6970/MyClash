import { describe, expect, it } from 'vitest';
import { normalizeMatchFormatConfig } from '@myclash/rulesets';
import { DEFAULT_SCORING_CONFIG } from '@myclash/types';
import { matchFormatBody, matchFormatForm } from './match-format-form';

/** The rules in force of a Tournament that stores a cap of 7 and a Swiss time limit. */
const RULES = {
  matchFormat: normalizeMatchFormatConfig({
    pointCap: 7,
    timeLimitsSeconds: { pool: 90, swiss: 60, bracket: 120, finals: 150 },
  }),
  tf: null,
  scoring: { ...DEFAULT_SCORING_CONFIG, afterblowMode: 'deductive' as const },
};

describe('matchFormatForm', () => {
  it("shows the engine's values in force, and the afterblow mode of the scoring config", () => {
    const form = matchFormatForm(RULES);
    expect(form).toMatchObject({
      pointCap: 7,
      timeLimitsSeconds: { pool: 90, bracket: 120, finals: 150 },
      softClockLimitSeconds: 5,
      maxDoubleHits: 4,
      afterblowMode: 'deductive',
    });
  });

  it('holds only the phases the screens show, so a Swiss value is never sent back', () => {
    const form = matchFormatForm(RULES);
    expect(Object.keys(form.timeLimitsSeconds)).toEqual(['pool', 'bracket', 'finals']);
    expect(Object.keys(form.bestOf)).toEqual(['pool', 'bracket', 'finals']);
    expect(Object.keys(form.levelAtTime)).toEqual(['pool', 'bracket', 'finals']);
  });
});

describe('matchFormatBody', () => {
  it('sends the match format under the settings and the afterblow mode under the scoring', () => {
    const body = matchFormatBody(matchFormatForm(RULES));
    expect(body['scoringConfig']).toEqual({ afterblowMode: 'deductive' });
    expect(body['rulesetConfig']).toMatchObject({ matchFormat: { pointCap: 7 } });
    expect(body['rulesetConfig']).not.toHaveProperty('matchFormat.afterblowMode');
  });
});
