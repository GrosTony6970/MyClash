/**
 * packages/rulesets/src/tf_v1/targets.test.ts
 *
 * Named targets, and the derivation that keeps every config written before
 * they existed parsing unchanged.
 */
import { describe, it, expect } from 'vitest';
import {
  TargetSchema,
  TargetsSchema,
  DEFAULT_TARGETS,
  MAX_TARGETS,
  MAX_STORED_TARGET_VALUE,
  withDerivedTargets,
} from './targets';
import { TFv1ConfigSchema, TFv1DefaultConfig } from './config';

describe('TargetSchema', () => {
  it('accepts a named target', () => {
    expect(TargetSchema.parse({ name: 'Head', value: 3 })).toEqual({ name: 'Head', value: 3 });
  });

  it('trims the name', () => {
    expect(TargetSchema.parse({ name: '  Head  ', value: 3 }).name).toBe('Head');
  });

  it('rejects an empty or whitespace-only name', () => {
    expect(() => TargetSchema.parse({ name: '', value: 1 })).toThrow();
    expect(() => TargetSchema.parse({ name: '   ', value: 1 })).toThrow();
  });

  it('rejects a value below 1', () => {
    // A 0-point target would seed a button with attackerPts 0, which
    // createExchangeSchema rejects (firstStrikeValue min 1) — 400ing the POST
    // and getting the exchange dropped as terminal by the offline queue.
    expect(() => TargetSchema.parse({ name: 'Nothing', value: 0 })).toThrow();
    expect(() => TargetSchema.parse({ name: 'Negative', value: -1 })).toThrow();
  });

  it('rejects a non-integer value', () => {
    expect(() => TargetSchema.parse({ name: 'Half', value: 1.5 })).toThrow();
  });

  it('stays liberal on read above the exchange cap', () => {
    // The 1..10 authoring bound belongs to the API DTO. The engine must still
    // parse a config stored before that bound existed — rejecting here would
    // 400 the standings page, turning a broken button into a broken tournament.
    expect(TargetSchema.parse({ name: 'Legacy', value: 15 }).value).toBe(15);
    expect(() =>
      TargetSchema.parse({ name: 'Absurd', value: MAX_STORED_TARGET_VALUE + 1 }),
    ).toThrow();
  });
});

describe('TargetsSchema', () => {
  it('requires at least one target', () => {
    expect(() => TargetsSchema.parse([])).toThrow();
  });

  it('caps the count', () => {
    const many = Array.from({ length: MAX_TARGETS + 1 }, (_, i) => ({
      name: `T${i}`,
      value: 1,
    }));
    expect(() => TargetsSchema.parse(many)).toThrow();
    expect(TargetsSchema.parse(many.slice(0, MAX_TARGETS))).toHaveLength(MAX_TARGETS);
  });

  it('accepts a count other than two — the case the legacy pair could not express', () => {
    const threeTargets = [
      { name: 'Head', value: 3 },
      { name: 'Torso', value: 2 },
      { name: 'Limb', value: 1 },
    ];
    expect(TargetsSchema.parse(threeTargets)).toHaveLength(3);
    expect(TargetsSchema.parse([{ name: 'Hit', value: 1 }])).toHaveLength(1);
  });
});

describe('withDerivedTargets — legacy back-compat', () => {
  it('derives the pair, highest value first', () => {
    const out = withDerivedTargets({
      targetValues: { deepTarget: 5, shallowTarget: 3 },
    }) as Record<string, unknown>;
    expect(out['targets']).toEqual([
      { name: 'Deep', value: 5 },
      { name: 'Shallow', value: 3 },
    ]);
  });

  it('never overwrites explicit targets', () => {
    const explicit = [{ name: 'Head', value: 3 }];
    const out = withDerivedTargets({
      targets: explicit,
      targetValues: { deepTarget: 5, shallowTarget: 3 },
    }) as Record<string, unknown>;
    expect(out['targets']).toBe(explicit);
  });

  it('passes non-objects through untouched', () => {
    expect(withDerivedTargets(null)).toBe(null);
    expect(withDerivedTargets(undefined)).toBe(undefined);
    expect(withDerivedTargets('nope')).toBe('nope');
    const arr = [1, 2];
    expect(withDerivedTargets(arr)).toBe(arr);
  });

  it('leaves a config with no legacy pair alone', () => {
    const bare = { winBonus: 4 };
    expect(withDerivedTargets(bare)).toBe(bare);
  });
});

describe('TFv1ConfigSchema — targets integration', () => {
  it('defaults to the federal pair', () => {
    expect(TFv1DefaultConfig.targets).toEqual(DEFAULT_TARGETS);
  });

  it('keeps the legacy mirror in the default config', () => {
    // Still read by admin surfaces and API paths mid-migration.
    expect(TFv1DefaultConfig.targetValues).toEqual({ deepTarget: 2, shallowTarget: 1 });
  });

  it('parses a legacy-only config into named targets', () => {
    const parsed = TFv1ConfigSchema.parse({
      targetValues: { deepTarget: 4, shallowTarget: 2 },
    });
    expect(parsed.targets).toEqual([
      { name: 'Deep', value: 4 },
      { name: 'Shallow', value: 2 },
    ]);
  });

  it('parses a targets-only config without inventing a legacy pair from it', () => {
    const parsed = TFv1ConfigSchema.parse({
      targets: [
        { name: 'Head', value: 3 },
        { name: 'Torso', value: 2 },
        { name: 'Limb', value: 1 },
      ],
    });
    expect(parsed.targets).toHaveLength(3);
    // The legacy mirror falls back to ITS default — derivation is one-way, so
    // nothing downstream should treat targetValues as a summary of targets.
    expect(parsed.targetValues).toEqual({ deepTarget: 2, shallowTarget: 1 });
  });

  it('lets explicit targets win over a stale legacy pair', () => {
    const parsed = TFv1ConfigSchema.parse({
      targets: [{ name: 'Hit', value: 1 }],
      targetValues: { deepTarget: 9, shallowTarget: 8 },
    });
    expect(parsed.targets).toEqual([{ name: 'Hit', value: 1 }]);
  });
});
