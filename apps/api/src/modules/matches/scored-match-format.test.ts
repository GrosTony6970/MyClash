/**
 * The format a ruleset plays under: only a ruleset that SAYS it has no doubles
 * rule loses the limit. One that says nothing keeps it, as every ruleset did
 * before a ruleset could say.
 */
import { describe, expect, it } from 'vitest';
import { TF_v1, type Ruleset } from '@myclash/rulesets';
import { scoredMatchFormat } from './scored-match-format';

const CONFIG = { matchFormat: { maxDoubleHits: 3 } };
const saying = (hasMaxDoubles?: boolean): Ruleset => ({
  ...TF_v1,
  metadata: { ...TF_v1.metadata, hasMaxDoubles } as Ruleset['metadata'],
});

describe('scoredMatchFormat', () => {
  it('drops the limit for a ruleset that says it has no doubles rule', () => {
    expect(scoredMatchFormat(CONFIG, saying(false)).maxDoubleHits).toBeNull();
  });

  it('keeps the limit for a ruleset that says it has the rule, or says nothing', () => {
    expect(scoredMatchFormat(CONFIG, saying(true)).maxDoubleHits).toBe(3);
    expect(scoredMatchFormat(CONFIG, saying(undefined)).maxDoubleHits).toBe(3);
    expect(scoredMatchFormat(CONFIG, { ...TF_v1, metadata: undefined }).maxDoubleHits).toBe(3);
  });

  it('reads a config with no format as the default format', () => {
    expect(scoredMatchFormat(null, TF_v1).maxDoubleHits).toBe(
      scoredMatchFormat({}, TF_v1).maxDoubleHits,
    );
  });
});
