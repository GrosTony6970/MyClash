/**
 * The resolver is where a stored ruleset becomes a runnable one, so it is where
 * an org-authored grammar either reaches the engine or silently vanishes.
 *
 * Before migration 0143 there was nowhere to store `targets` / `hasAfterblow`
 * for a non-system row (tf_config is read for is_system rows only), and
 * `createFormulaRuleset` emitted no metadata at all — so anything driving UI
 * off `metadata.hasAfterblow` read `undefined` for exactly the rulesets
 * self-service exists to serve.
 *
 * ⚠ NEVER assert on a whole Ruleset object here — no `toEqual`, no `toBeNull`
 * on the ruleset itself. A Ruleset carries `configSchema`, which for the
 * formula kind is `FormulaConfigSchema`: a recursive Zod schema whose binop
 * branch exposes `left`/`right` as LAZY GETTERS nested 32 deep
 * (packages/rulesets/src/formula/types.ts). Any deep serializer walking it —
 * which is exactly what vitest does to render a failure diff — expands 3^32
 * nodes and takes the worker out with "JavaScript heap out of memory" instead
 * of printing a readable failure. Compare scalars, or compare `x === null` so
 * the diff is over booleans.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registry, TF_v1 } from '@myclash/rulesets';
import { RulesetResolver } from './ruleset-resolver.service';

const FORMULA = { type: 'var', name: 'victories' };
const CONSTANTS = { pointsPerVictory: 3, pointsPerTie: 1, pointsPerLoss: 0, doublePenalty: 0 };

/**
 * Mirrors `resolve()`'s two-step query shape rather than using an ordered
 * `mockReturnValueOnce` queue, which desyncs the moment a query is added:
 *
 *   call 1 — resolveFromVersionSnapshot's parent lookup
 *   call 2 — the snapshot row if that parent existed, otherwise the
 *            parent-row fallback's own query
 */
function makeResolver(rows: { parent?: unknown; snapshot?: unknown; row?: unknown }) {
  let call = 0;
  const from = vi.fn().mockImplementation(() => {
    call += 1;
    let data: unknown = null;
    if (call === 1) data = rows.parent ?? null;
    else if (rows.parent) data = rows.snapshot ?? null;
    else data = rows.row ?? null;
    return {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data }),
    };
  });
  return new RulesetResolver({ service: { from } } as never);
}

describe('RulesetResolver — grammar', () => {
  beforeEach(() => {
    if (!registry.has(TF_v1.code, TF_v1.version)) registry.register(TF_v1);
  });

  it('short-circuits a coded ruleset to the registry without touching the DB', async () => {
    const from = vi.fn();
    const resolver = new RulesetResolver({ service: { from } } as never);
    const ruleset = await resolver.resolve('TF_v1', '1.0.0');
    expect(ruleset?.code).toBe('TF_v1');
    expect(from).not.toHaveBeenCalled();
  });

  it('carries a version snapshot’s declared grammar onto the ruleset', async () => {
    // Snapshots must round-trip grammar, or publishing and then rolling back
    // would silently reset it — the "an edit changed how a pinned tournament
    // scores" failure custom_ruleset_versions exists to prevent.
    const resolver = makeResolver({
      parent: { id: 'p1', name: 'House rules', is_system: false },
      snapshot: {
        version: '1.0.0',
        score_formula: FORMULA,
        constants: CONSTANTS,
        tiebreakers: [],
        targets: [
          { name: 'Head', value: 3 },
          { name: 'Body', value: 1 },
        ],
        has_afterblow: true,
        afterblow_mode: 'deductive',
      },
    });

    const ruleset = await resolver.resolve('custom_house', '1.0.0');
    expect(ruleset?.metadata?.hasAfterblow).toBe(true);
    expect(ruleset?.metadata?.defaultAfterblowMode).toBe('deductive');
    expect(ruleset?.metadata?.targets).toHaveLength(2);
  });

  it('carries the parent row’s grammar when no snapshot exists', async () => {
    const resolver = makeResolver({
      row: {
        code: 'custom_house',
        version: '1.0.0',
        name: 'House rules',
        status: 'published',
        is_system: false,
        score_formula: FORMULA,
        constants: CONSTANTS,
        tiebreakers: [],
        targets: [{ name: 'Hit', value: 1 }],
        has_afterblow: true,
        afterblow_mode: 'full',
      },
    });

    const ruleset = await resolver.resolve('custom_house', '1.0.0');
    expect(ruleset?.metadata?.hasAfterblow).toBe(true);
    expect(ruleset?.metadata?.targets).toEqual([{ name: 'Hit', value: 1 }]);
  });

  it('reads a pre-0143 row as declaring no afterblow, not as undefined', async () => {
    // Nulls are what a row written before the columns existed looks like. They
    // must resolve to a DEFINITE false — the UI has never offered afterblow
    // controls for a custom ruleset, so nothing should switch on at deploy.
    const resolver = makeResolver({
      row: {
        code: 'custom_old',
        version: '1.0.0',
        name: 'Old',
        status: 'published',
        is_system: false,
        score_formula: FORMULA,
        constants: CONSTANTS,
        tiebreakers: [],
        targets: null,
        has_afterblow: null,
        afterblow_mode: null,
      },
    });

    const ruleset = await resolver.resolve('custom_old', '1.0.0');
    expect(ruleset?.metadata).toBeDefined();
    expect(ruleset?.metadata?.hasAfterblow).toBe(false);
    expect(ruleset?.metadata?.defaultAfterblowMode).toBe(null);
  });

  it('refuses an unpublished row', async () => {
    const resolver = makeResolver({
      row: {
        code: 'custom_draft',
        version: '1.0.0',
        name: 'Draft',
        status: 'draft',
        is_system: false,
        score_formula: FORMULA,
        constants: CONSTANTS,
        tiebreakers: [],
        targets: null,
        has_afterblow: false,
        afterblow_mode: null,
      },
    });

    // `=== null` rather than toBeNull(): see the serializer warning at the top.
    expect((await resolver.resolve('custom_draft', '1.0.0')) === null).toBe(true);
  });
});
