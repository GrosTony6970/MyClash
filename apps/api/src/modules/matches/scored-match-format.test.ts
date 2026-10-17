/**
 * The format a ruleset plays under: only a ruleset that SAYS it has no doubles
 * rule loses the limit. One that says nothing keeps it, as every ruleset did
 * before a ruleset could say.
 */
import { Logger } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { TF_v1, TF_v1_1_0_0, type Ruleset } from '@myclash/rulesets';
import { scoredMatchFormat, scoredRuleset } from './scored-match-format';

describe('scoredRuleset', () => {
  it("is the ruleset the bout's pair names", async () => {
    const rulesets = { resolve: vi.fn().mockResolvedValue(TF_v1_1_0_0) };
    expect(await scoredRuleset(rulesets as never, 'TF_v1', '1.0.0')).toBe(TF_v1_1_0_0);
    expect(rulesets.resolve).toHaveBeenCalledWith('TF_v1', '1.0.0');
  });

  it('refuses, and says so, a pair that does not resolve: never TF_v1 in its place', async () => {
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const rulesets = { resolve: vi.fn().mockResolvedValue(null) };
    await expect(scoredRuleset(rulesets as never, 'custom_gone', '1.0.0')).rejects.toThrow(
      'custom_gone@1.0.0 does not resolve',
    );
    expect(error).toHaveBeenCalledWith(expect.stringContaining('custom_gone@1.0.0'));
    error.mockRestore();
  });
});

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
