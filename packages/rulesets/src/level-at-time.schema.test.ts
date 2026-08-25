import { describe, expect, it } from 'vitest';
import { MatchFormatConfigSchema, normalizeMatchFormatConfig } from './match-format';

/**
 * VALIDATING a level-at-time chain — the schema half.
 *
 * The chain itself is arithmetic and lives in `@myclash/rules`, tested in
 * `level-at-time.test.ts` there. This file is the other side of that split: what
 * the schema accepts, what it refuses, and what survives a round-trip through
 * `normalizeMatchFormatConfig`. Its own file because `match-format.test.ts` sat
 * exactly on the 400-line budget.
 */
describe('level-at-time chain schema', () => {
  it('refuses a chain that ends in extra time', () => {
    // The bad state is unrepresentable rather than merely undesirable: a chain
    // ending in extra time describes a bout that can come back level for ever,
    // so the referee works to the end of the chain and still cannot finish it.
    // Better a 400 in the organiser's editor than a bout with no exit.
    expect(() =>
      MatchFormatConfigSchema.parse({
        levelAtTime: { bracket: [{ kind: 'extra_time', seconds: 60 }] },
      }),
    ).toThrow(/last step must be draw or sudden_death/);
  });

  it('accepts a chain that ends on either terminal step, and refuses an empty one', () => {
    const parsed = MatchFormatConfigSchema.parse({
      levelAtTime: {
        pool: [{ kind: 'sudden_death' }],
        bracket: [{ kind: 'extra_time', seconds: 30 }, { kind: 'draw' }],
        finals: [{ kind: 'draw' }],
      },
    });
    expect(parsed.levelAtTime.pool).toEqual([{ kind: 'sudden_death' }]);
    expect(parsed.levelAtTime.bracket).toEqual([
      { kind: 'extra_time', seconds: 30 },
      { kind: 'draw' },
    ]);
    // An empty chain has no terminal step to reach at all.
    expect(() => MatchFormatConfigSchema.parse({ levelAtTime: { pool: [] } })).toThrow();
  });

  it('preserves a config that carries ONLY the level-at-time chain', () => {
    // `normalizeMatchFormatConfig` picks its branch from which keys are present,
    // and the legacy branch REBUILDS a config from three named legacy fields —
    // so a modern key arriving alone is discarded rather than rejected. The
    // organiser's PATCH answers 200 and their chain is simply not there. That
    // is the second time: `bestOf` was the first.
    const config = normalizeMatchFormatConfig({ levelAtTime: { finals: [{ kind: 'draw' }] } });
    expect(config.levelAtTime.finals).toEqual([{ kind: 'draw' }]);
  });

  it('hands every parse its OWN default chain', () => {
    // The chain default is a FUNCTION, unlike its number-valued siblings. An
    // object-literal default in zod is one shared reference, which is harmless
    // for `{ pool: 90 }` and is not for arrays of objects: a caller pushing a
    // step onto one parsed config would be editing every later parse's default.
    const first = MatchFormatConfigSchema.parse({});
    first.levelAtTime.pool.push({ kind: 'sudden_death' });
    expect(MatchFormatConfigSchema.parse({}).levelAtTime.pool).toEqual([{ kind: 'draw' }]);
  });
});
