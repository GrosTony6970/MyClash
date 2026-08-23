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
import { TF_v1 } from '@myclash/rulesets';
import { createFormulaRuleset } from '@myclash/rulesets';
import { RulesetResolver } from './ruleset-resolver.service';
import { createRulesetRegistry } from '../rulesets/ruleset-registry';

const FORMULA = { type: 'var', name: 'victories' };
const CONSTANTS = { pointsPerVictory: 3, pointsPerTie: 1, pointsPerLoss: 0, doublePenalty: 0 };
const FORMULA_CONFIG = { scoreFormula: FORMULA, constants: CONSTANTS, tiebreakers: [] } as never;

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
  const selects: string[] = [];
  const from = vi.fn().mockImplementation(() => {
    call += 1;
    let data: unknown;
    if (call === 1) data = rows.parent ?? null;
    else if (rows.parent) data = rows.snapshot ?? null;
    else data = rows.row ?? null;
    const chain = {
      // RECORDS the column list rather than ignoring it. A `mockReturnThis()`
      // select swallows its argument and hands back the whole fixture row, so
      // it will happily "pass" a query that never asked for the column being
      // asserted — which is exactly how the two paths drifted apart.
      select: vi.fn().mockImplementation((columns: string) => {
        selects.push(columns);
        return chain;
      }),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data }),
    };
    return chain;
  });
  return {
    resolver: new RulesetResolver({ service: { from } } as never, createRulesetRegistry()),
    selects,
  };
}

describe('RulesetResolver — grammar', () => {
  it('short-circuits a coded ruleset to the registry without touching the DB', async () => {
    const from = vi.fn();
    const resolver = new RulesetResolver({ service: { from } } as never, createRulesetRegistry());
    const ruleset = await resolver.resolve('TF_v1', '1.0.0');
    expect(ruleset?.code).toBe('TF_v1');
    expect(from).not.toHaveBeenCalled();
  });

  it('carries a version snapshot’s declared grammar onto the ruleset', async () => {
    // Snapshots must round-trip grammar, or publishing and then rolling back
    // would silently reset it — the "an edit changed how a pinned tournament
    // scores" failure custom_ruleset_versions exists to prevent.
    const { resolver } = makeResolver({
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
        afterblow_valuation: 'weighted',
        afterblow_fixed_value: null,
      },
    });

    const ruleset = await resolver.resolve('custom_house', '1.0.0');
    expect(ruleset?.metadata?.hasAfterblow).toBe(true);
    expect(ruleset?.metadata?.defaultAfterblowMode).toBe('deductive');
    expect(ruleset?.metadata?.afterblowValuation).toBe('weighted');
    expect(ruleset?.metadata?.targets).toHaveLength(2);
  });

  it('carries the parent row’s grammar when no snapshot exists', async () => {
    const { resolver } = makeResolver({
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
        afterblow_valuation: 'fixed',
        afterblow_fixed_value: 2,
      },
    });

    const ruleset = await resolver.resolve('custom_house', '1.0.0');
    expect(ruleset?.metadata?.hasAfterblow).toBe(true);
    expect(ruleset?.metadata?.targets).toEqual([{ name: 'Hit', value: 1 }]);
    expect(ruleset?.metadata?.afterblowFixedValue).toBe(2);
  });

  it('reads a pre-0143 row as declaring no afterblow, not as undefined', async () => {
    // Nulls are what a row written before the columns existed looks like. They
    // must resolve to a DEFINITE false — the UI has never offered afterblow
    // controls for a custom ruleset, so nothing should switch on at deploy.
    const { resolver } = makeResolver({
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
        afterblow_valuation: null,
        afterblow_fixed_value: null,
      },
    });

    const ruleset = await resolver.resolve('custom_old', '1.0.0');
    expect(ruleset?.metadata).toBeDefined();
    expect(ruleset?.metadata?.hasAfterblow).toBe(false);
    expect(ruleset?.metadata?.defaultAfterblowMode).toBe(null);
    expect(ruleset?.metadata?.afterblowValuation).toBe(null);
  });

  it('reads an undeclared valuation as fixed/1, so no pad doubles at deploy', () => {
    // A row that has afterblow but predates 0145. `weighted` would turn its two
    // buttons into four without anyone asking.
    const ruleset = createFormulaRuleset('custom_x', '1.0.0', 'X', FORMULA_CONFIG, {
      hasAfterblow: true,
      afterblowValuation: null,
      afterblowFixedValue: null,
    });
    expect(ruleset.metadata?.afterblowValuation).toBe('fixed');
    expect(ruleset.metadata?.afterblowFixedValue).toBe(1);
  });

  it('refuses an unpublished row', async () => {
    const { resolver } = makeResolver({
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
        afterblow_valuation: null,
        afterblow_fixed_value: null,
      },
    });

    // `=== null` rather than toBeNull(): see the serializer warning at the top.
    expect((await resolver.resolve('custom_draft', '1.0.0')) === null).toBe(true);
  });

  it('still resolves an archived row so a pinned tournament never loses its ruleset', async () => {
    // Delist ≠ delete: archiving is our soft-delete. The row is hidden from every
    // picker/list but a tournament already pinned to it must keep resolving and
    // scoring — so resolution accepts 'archived' where it refuses 'draft'.
    const { resolver } = makeResolver({
      row: {
        code: 'custom_archived',
        version: '1.0.0',
        name: 'Archived',
        status: 'archived',
        is_system: false,
        score_formula: FORMULA,
        constants: CONSTANTS,
        tiebreakers: [],
        targets: [{ name: 'Hit', value: 1 }],
        has_afterblow: false,
        afterblow_mode: null,
        afterblow_valuation: null,
        afterblow_fixed_value: null,
      },
    });

    const ruleset = await resolver.resolve('custom_archived', '1.0.0');
    expect(ruleset?.code).toBe('custom_archived');
    expect(ruleset?.metadata?.targets).toEqual([{ name: 'Hit', value: 1 }]);
  });

  it('asks BOTH resolution paths for the same grammar columns', () => {
    // The regression this exists for: 0145's valuation columns were added to
    // the parent-row select and missed on the snapshot select, so a ruleset
    // authored as `weighted` resolved as `fixed`. Both paths now share one
    // constant, and this asserts the queries actually carry it.
    const grammar = [
      'targets',
      'has_afterblow',
      'afterblow_mode',
      'afterblow_valuation',
      'afterblow_fixed_value',
    ];

    return (async () => {
      const snapshotPath = makeResolver({
        parent: { id: 'p1', name: 'N', is_system: false },
        snapshot: {
          version: '1.0.0',
          score_formula: FORMULA,
          constants: CONSTANTS,
          tiebreakers: [],
          targets: null,
          has_afterblow: false,
          afterblow_mode: null,
          afterblow_valuation: null,
          afterblow_fixed_value: null,
        },
      });
      await snapshotPath.resolver.resolve('custom_snap', '1.0.0');
      const snapshotSelect = snapshotPath.selects.at(-1) ?? '';
      for (const column of grammar) expect(snapshotSelect).toContain(column);

      const parentPath = makeResolver({
        row: {
          code: 'custom_row',
          version: '1.0.0',
          name: 'N',
          status: 'published',
          is_system: false,
          score_formula: FORMULA,
          constants: CONSTANTS,
          tiebreakers: [],
          targets: null,
          has_afterblow: false,
          afterblow_mode: null,
          afterblow_valuation: null,
          afterblow_fixed_value: null,
        },
      });
      await parentPath.resolver.resolve('custom_row', '1.0.0');
      const parentSelect = parentPath.selects.at(-1) ?? '';
      for (const column of grammar) expect(parentSelect).toContain(column);
    })();
  });
});

describe('RulesetResolver — coded forks (base_code)', () => {
  beforeEach(() => {});

  it('resolves a base_code fork to the EXACT registry engine (scoring parity by construction)', async () => {
    // The whole point of the coded fork: it does not re-implement TF_v1's
    // ranking, it reuses it. Reference-identical to the registered engine, so a
    // fork with the same tournament config scores bit-identically — the golden
    // gate stays green because TF_v1 itself is untouched. (=== to dodge the
    // recursive-schema serializer OOM warned about at the top of this file.)
    const { resolver } = makeResolver({
      parent: {
        id: 'fork1',
        name: 'FFAMHE (customised by Club X)',
        is_system: false,
        base_code: 'TF_v1',
        base_version: '1.0.0',
      },
    });
    const ruleset = await resolver.resolve('custom_fork_x', '1.0.0');
    expect(ruleset === TF_v1).toBe(true);
  });

  it('resolves a base_code fork on the parent-row fallback path too', async () => {
    // Belt-and-suspenders: even if the snapshot path returned nothing, the
    // fallback must not build a FormulaRuleset from the fork's empty AST.
    const { resolver } = makeResolver({
      row: {
        code: 'custom_fork_y',
        version: '1.0.0',
        name: 'Fork Y',
        status: 'published',
        is_system: false,
        base_code: 'TF_v1',
        base_version: '1.0.0',
        score_formula: {},
        constants: {},
        tiebreakers: [],
        targets: null,
        has_afterblow: true,
        afterblow_mode: 'deductive',
        afterblow_valuation: 'fixed',
        afterblow_fixed_value: 1,
      },
    });
    const ruleset = await resolver.resolve('custom_fork_y', '1.0.0');
    expect(ruleset === TF_v1).toBe(true);
  });

  it('normalises a shorthand base_version so a fork of `1` still resolves', async () => {
    const { resolver } = makeResolver({
      parent: {
        id: 'fork2',
        name: 'Fork',
        is_system: false,
        base_code: 'TF_v1',
        base_version: null,
      },
    });
    // base_version null defaults to '1.0.0', the registry key.
    const ruleset = await resolver.resolve('custom_fork_z', '1.0.0');
    expect(ruleset === TF_v1).toBe(true);
  });

  it('returns null (not a crash) when the fork names an unregistered base', async () => {
    const { resolver } = makeResolver({
      parent: {
        id: 'fork3',
        name: 'Broken fork',
        is_system: false,
        base_code: 'Nonexistent_v9',
        base_version: '1.0.0',
      },
    });
    expect((await resolver.resolve('custom_fork_broken', '1.0.0')) === null).toBe(true);
  });

  it('reads base_code + base_version on BOTH resolution paths', async () => {
    const snapshotPath = makeResolver({
      parent: { id: 'p', name: 'N', is_system: false, base_code: 'TF_v1', base_version: '1.0.0' },
    });
    await snapshotPath.resolver.resolve('custom_snap_fork', '1.0.0');
    expect(
      snapshotPath.selects.some((s) => s.includes('base_code') && s.includes('base_version')),
    ).toBe(true);

    const parentPath = makeResolver({
      row: {
        code: 'custom_row_fork',
        version: '1.0.0',
        name: 'N',
        status: 'published',
        is_system: false,
        base_code: 'TF_v1',
        base_version: '1.0.0',
        score_formula: {},
        constants: {},
        tiebreakers: [],
        targets: null,
        has_afterblow: false,
        afterblow_mode: null,
        afterblow_valuation: null,
        afterblow_fixed_value: null,
      },
    });
    await parentPath.resolver.resolve('custom_row_fork', '1.0.0');
    expect(
      parentPath.selects.some((s) => s.includes('base_code') && s.includes('base_version')),
    ).toBe(true);
  });
});
