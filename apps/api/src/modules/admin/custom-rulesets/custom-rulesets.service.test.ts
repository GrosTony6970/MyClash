import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registry, TF_v1 } from '@myclash/rulesets';
import { CustomRulesetsService } from './custom-rulesets.service';

const fromMock = vi.fn();
const mockSupabase = { service: { from: fromMock } };

function makeChain(result: { data?: unknown; error?: unknown } = {}) {
  const chain: Record<string, unknown> = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
    single: vi.fn().mockResolvedValue(result),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    then: undefined,
  };
  // Promise-like for queries that don't chain further (await query)
  (chain as { then: unknown }).then = (resolve: (value: unknown) => unknown) => resolve(result);
  return chain;
}

const validConstants = { pointsPerVictory: 3, pointsPerTie: 1, pointsPerLoss: 0, doublePenalty: 0 };
const validTiebreakers = [{ variable: 'victories' as const, direction: 'desc' as const }];

describe('CustomRulesetsService', () => {
  let service: CustomRulesetsService;

  beforeEach(() => {
    vi.clearAllMocks();
    // Register the TF_v1 built-in so hydration tests can resolve it.
    if (!registry.has(TF_v1.code, TF_v1.version)) {
      registry.register(TF_v1);
    }
    service = new CustomRulesetsService(mockSupabase as never);
  });

  it('rejects creation with an invalid formula AST', async () => {
    await expect(
      service.create(
        {
          name: 'Bad',
          scoreFormula: { type: 'nonsense' } as unknown as Record<string, unknown>,
          constants: validConstants,
          tiebreakers: validTiebreakers,
        },
        'actor-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects creation with an unknown variable in the AST', async () => {
    await expect(
      service.create(
        {
          name: 'Bad',
          scoreFormula: { type: 'var', name: 'doesNotExist' } as unknown as Record<string, unknown>,
          constants: validConstants,
          tiebreakers: validTiebreakers,
        },
        'actor-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('allows super-admin to edit a system ruleset (controller-level guard enforces the role)', async () => {
    // Round 7: the in-service is_system guard for update() is lifted because
    // the controller already requires PlatformRoleGuard. The service must
    // accept the patch and write the updates without throwing Forbidden.
    fromMock.mockReturnValue(
      makeChain({
        data: { id: 'r1', is_system: true, is_default: true, code: 'TF_v1', version: '1.0.0' },
        error: null,
      }),
    );

    await expect(service.update('r1', { name: 'New name' }, 'actor-1')).resolves.toMatchObject({
      id: 'r1',
    });
  });

  it('refuses to delete a system ruleset', async () => {
    fromMock.mockReturnValue(
      makeChain({ data: { id: 'r1', is_system: true, is_default: false }, error: null }),
    );

    await expect(service.remove('r1', 'actor-1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses to delete the default ruleset', async () => {
    fromMock.mockReturnValue(
      makeChain({ data: { id: 'r1', is_system: false, is_default: true }, error: null }),
    );

    await expect(service.remove('r1', 'actor-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses to set as default when not published', async () => {
    fromMock.mockReturnValue(
      makeChain({ data: { id: 'r1', status: 'draft', is_system: false }, error: null }),
    );
    await expect(service.setDefault('r1', 'actor-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('hydrates a system ruleset detail with the coded rankingChain + metadata', async () => {
    fromMock.mockReturnValue(
      makeChain({
        data: {
          id: 'tf-v1-row',
          code: 'TF_v1',
          version: '1.0.0',
          name: 'TF_v1',
          description: null,
          status: 'published',
          score_formula: {},
          constants: {},
          tiebreakers: [],
          is_default: true,
          is_system: true,
          created_by_user_id: null,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        },
        error: null,
      }),
    );

    const result = await service.getById('tf-v1-row');

    // The DB row's `tiebreakers` is empty, but the response should now
    // surface the coded rankingChain (4 entries for TF v1).
    expect(result.systemRankingChain).toEqual([
      { key: 'score', direction: 'desc' },
      { key: 'W', direction: 'desc' },
      { key: 'doubles', direction: 'asc' },
      { key: 'hitsReceived', direction: 'asc' },
    ]);
    // And the audit-friendly metadata block.
    expect(result.systemMetadata).toMatchObject({
      hasAfterblow: true,
      winBonus: 3,
      doublePenaltyFormula: 'n*(n-1)/3',
      deepTargetDefault: 2,
      shallowTargetDefault: 1,
    });
  });

  it('does not hydrate a non-system row', async () => {
    fromMock.mockReturnValue(
      makeChain({
        data: {
          id: 'custom-row',
          code: 'custom_x',
          version: '1.0.0',
          is_system: false,
          tiebreakers: [],
        },
        error: null,
      }),
    );

    const result = await service.getById('custom-row');
    expect(result.systemRankingChain).toBeUndefined();
    expect(result.systemMetadata).toBeUndefined();
  });

  // ── clone ──────────────────────────────────────────────────────────────────
  // clone() was the only write path that could produce a row create() /
  // createForOrg() / update() would all have rejected: it copied the source
  // columns straight into the INSERT without running validateConfig.

  it('refuses to clone a system ruleset', async () => {
    // Migration 0038 seeds system rows with EMPTY score_formula / constants /
    // tiebreakers because "the runtime always prefers the in-code plugin for
    // these codes" — true only while is_system is TRUE. Cloning flipped it to
    // false, so the resolver stopped short-circuiting to the registry and
    // built a FormulaRuleset from `{}`. Standings then died on "Cannot read
    // properties of undefined" while match scoring silently continued under
    // Generic_PointsCap. The clone also dropped tf_config, where every TF v1
    // tunable lives, so there was nothing to recover from either.
    fromMock.mockReturnValue(
      makeChain({
        data: {
          id: 'tf',
          code: 'TF_v1',
          version: '1.0.0',
          name: 'TF v1',
          is_system: true,
          score_formula: {},
          constants: {},
          tiebreakers: [],
        },
        error: null,
      }),
    );

    await expect(service.clone('tf', 'actor-1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('names the org flow in the refusal, since cloning a built-in is still supported there', async () => {
    // /org/:slug/rulesets/scoring/new?cloneFrom=<id> pre-fills the form from a
    // built-in and requires the operator to author a score formula, so it
    // cannot produce the empty-AST orphan. The message must point there rather
    // than reading as a flat "no".
    fromMock.mockReturnValue(
      makeChain({ data: { id: 'tf', code: 'TF_v1', is_system: true }, error: null }),
    );

    await expect(service.clone('tf', 'actor-1')).rejects.toThrow(/organisation/i);
  });

  it('refuses to clone a row whose stored formula is invalid', async () => {
    // The general invariant, not just the is_system case: a clone must satisfy
    // what every other writer satisfies. A guard alone would let a corrupt
    // non-system source row propagate.
    fromMock.mockReturnValue(
      makeChain({
        data: {
          id: 'broken',
          code: 'custom_broken',
          name: 'Broken',
          is_system: false,
          score_formula: {},
          constants: validConstants,
          tiebreakers: validTiebreakers,
        },
        error: null,
      }),
    );

    await expect(service.clone('broken', 'actor-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('clones a valid custom ruleset', async () => {
    fromMock.mockReturnValue(
      makeChain({
        data: {
          id: 'ok',
          code: 'custom_ok',
          name: 'Good',
          description: null,
          is_system: false,
          score_formula: { type: 'var', name: 'victories' },
          constants: validConstants,
          tiebreakers: validTiebreakers,
          match_format_defaults: null,
          double_penalty_formula: null,
        },
        error: null,
      }),
    );

    await expect(service.clone('ok', 'actor-1')).resolves.toMatchObject({ id: 'ok' });
  });
});

// ── snapshot / rollback round-trip the grammar columns ───────────────────────
// A snapshot that omits targets/afterblow means a tournament pinned to a
// published version resolves with NO grammar (the resolver reads them off the
// snapshot row) — a weighted-afterblow ruleset would silently become
// no-afterblow once frozen. snapshotVersion and rollback share grammarColumnsFrom
// so the capture and restore directions cannot drift.

describe('publish/rollback grammar round-trip', () => {
  let service: CustomRulesetsService;
  beforeEach(() => {
    vi.clearAllMocks();
    if (!registry.has(TF_v1.code, TF_v1.version)) registry.register(TF_v1);
    service = new CustomRulesetsService(mockSupabase as never);
  });

  const grammarRow = {
    targets: [
      { name: 'Head', value: 3 },
      { name: 'Limb', value: 1 },
    ],
    has_afterblow: true,
    afterblow_mode: 'deductive' as const,
    afterblow_valuation: 'weighted' as const,
    afterblow_fixed_value: null,
  };

  function dispatch(rows: {
    parent: Record<string, unknown>;
    snapshot?: Record<string, unknown>;
    capture: { insert?: Record<string, unknown>; update?: Record<string, unknown> };
  }) {
    return vi.fn().mockImplementation((table: string) => {
      const chain: Record<string, unknown> = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        maybeSingle: vi
          .fn()
          .mockResolvedValue(
            table === 'custom_ruleset_versions'
              ? { data: rows.snapshot ?? null, error: null }
              : { data: rows.parent, error: null },
          ),
        single: vi.fn().mockResolvedValue({ data: rows.parent, error: null }),
        insert: vi.fn().mockImplementation((payload: Record<string, unknown>) => {
          if (table === 'custom_ruleset_versions') rows.capture.insert = payload;
          return chain;
        }),
        update: vi.fn().mockImplementation((payload: Record<string, unknown>) => {
          if (table === 'custom_rulesets') rows.capture.update = payload;
          return chain;
        }),
        then: (resolve: (v: unknown) => unknown) => resolve({ data: rows.parent, error: null }),
      };
      return chain;
    });
  }

  it('snapshots the parent grammar when publishing', async () => {
    const capture: { insert?: Record<string, unknown> } = {};
    const parent = {
      id: 'r1',
      code: 'custom_x',
      version: '1.0.0',
      name: 'X',
      description: null,
      status: 'draft',
      is_system: false,
      score_formula: { type: 'var', name: 'victories' },
      constants: validConstants,
      tiebreakers: validTiebreakers,
      match_format_defaults: null,
      double_penalty_formula: null,
      ...grammarRow,
    };
    fromMock.mockImplementation(dispatch({ parent, capture }));

    await service.publish('r1', 'actor-1');

    expect(capture.insert).toMatchObject({
      targets: grammarRow.targets,
      has_afterblow: true,
      afterblow_mode: 'deductive',
      afterblow_valuation: 'weighted',
      afterblow_fixed_value: null,
    });
  });

  it('restores the snapshot grammar on rollback', async () => {
    const capture: { update?: Record<string, unknown> } = {};
    const parent = { id: 'r1', code: 'custom_x', is_system: false };
    const snapshot = {
      id: 'v1',
      version: '1.0.0',
      name: 'X',
      description: null,
      score_formula: {},
      constants: validConstants,
      tiebreakers: validTiebreakers,
      match_format_defaults: null,
      double_penalty_formula: null,
      ...grammarRow,
    };
    fromMock.mockImplementation(dispatch({ parent, snapshot, capture }));

    await service.rollback('r1', 'v1', 'actor-1');

    expect(capture.update).toMatchObject({
      targets: grammarRow.targets,
      has_afterblow: true,
      afterblow_mode: 'deductive',
      afterblow_valuation: 'weighted',
      afterblow_fixed_value: null,
      status: 'draft',
    });
  });
});
