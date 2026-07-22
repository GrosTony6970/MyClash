import { describe, expect, it } from 'vitest';
import {
  RULESET_EXPORT_FORMAT,
  RULESET_EXPORT_VERSION,
  buildRulesetExport,
  computeDefinitionHash,
  penaltyRulesetExportDefinitionSchema,
  rulesetExportEnvelopeSchema,
  scoringRulesetExportDefinitionSchema,
} from './ruleset-export';

describe('ruleset-export', () => {
  it('hashes a definition independently of key order (canonical serialisation)', () => {
    const a = { name: 'X', version: '1.0.0', scoreFormula: { a: 1, b: 2 } };
    const b = { scoreFormula: { b: 2, a: 1 }, version: '1.0.0', name: 'X' };
    expect(computeDefinitionHash(a)).toBe(computeDefinitionHash(b));
  });

  it('produces a different hash when the definition differs', () => {
    expect(computeDefinitionHash({ name: 'X' })).not.toBe(computeDefinitionHash({ name: 'Y' }));
  });

  it('builds a versioned envelope stamped with the integrity hash', () => {
    const def = { name: 'Cutlass', version: '1.0.0', scoreFormula: {} };
    const env = buildRulesetExport('scoring', def);
    expect(env.format).toBe(RULESET_EXPORT_FORMAT);
    expect(env.formatVersion).toBe(RULESET_EXPORT_VERSION);
    expect(env.type).toBe('scoring');
    expect(env.definitionHash).toBe(computeDefinitionHash(def));
    expect(rulesetExportEnvelopeSchema.safeParse(env).success).toBe(true);
  });

  it('rejects an envelope from another tool or a future format version', () => {
    const valid = buildRulesetExport('scoring', { name: 'X', version: '1', scoreFormula: {} });
    expect(rulesetExportEnvelopeSchema.safeParse({ ...valid, format: 'other.tool' }).success).toBe(
      false,
    );
    expect(rulesetExportEnvelopeSchema.safeParse({ ...valid, formatVersion: 2 }).success).toBe(
      false,
    );
  });

  it('rejects a scoring definition carrying a coded-fork base (not portable)', () => {
    // The strict schema drops any envelope that smuggles in a base_code fork —
    // those reuse a named engine that need not exist on the target platform.
    const parsed = scoringRulesetExportDefinitionSchema.safeParse({
      name: 'Fork',
      scoreFormula: {},
      baseCode: 'TF_v1',
    });
    expect(parsed.success).toBe(false);
  });

  it('accepts a valid penalty definition and rejects a bad accumulation scope', () => {
    const good = { name: 'P', version: '1.0.0', accumulationScope: 'match', entries: [] };
    expect(penaltyRulesetExportDefinitionSchema.safeParse(good).success).toBe(true);
    expect(
      penaltyRulesetExportDefinitionSchema.safeParse({ ...good, accumulationScope: 'bogus' })
        .success,
    ).toBe(false);
  });
});
