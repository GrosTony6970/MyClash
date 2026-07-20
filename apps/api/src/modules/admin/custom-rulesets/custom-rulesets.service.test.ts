import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DOUBLE_PENALTY_FORMULA_KEYS, registry, TF_v1 } from '@myclash/rulesets';
import {
  CustomRulesetsService,
  grammarColumns,
  validateDoublePenaltyFormula,
} from './custom-rulesets.service';

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
    // the controller already requires SuperAdminGuard. The service must
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
          name: 'TF (Tournois Fédéraux FFAMHE)',
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

describe('validateDoublePenaltyFormula', () => {
  // This used to accept any character-whitelisted expression and sanity-check it
  // with `new Function('n', ...)`. AGENTS.md hard rule #5 forbids eval/Function
  // outright, and a character filter cannot make code execution safe — it only
  // makes it narrow. The engine's whitelist is now the only accepted input.
  it('accepts every key the engine can actually dispatch on', () => {
    for (const key of DOUBLE_PENALTY_FORMULA_KEYS) {
      expect(validateDoublePenaltyFormula(key)).toBe(key);
    }
  });

  it('trims surrounding whitespace', () => {
    expect(validateDoublePenaltyFormula('  n*(n-1)/3  ')).toBe('n*(n-1)/3');
  });

  it('rejects an expression the engine cannot dispatch on', () => {
    // 'n*2' passed the old character filter, then broke every tournament
    // create/update on that ruleset once doublePenaltyFormula became a z.enum —
    // and if it slipped past, the engine silently used the federal formula.
    expect(() => validateDoublePenaltyFormula('n*2')).toThrow(BadRequestException);
    expect(() => validateDoublePenaltyFormula('n*2')).toThrow(/Allowed values/);
  });

  it('rejects an empty formula', () => {
    expect(() => validateDoublePenaltyFormula('   ')).toThrow(BadRequestException);
  });

  it('rejects a code-execution attempt outright', () => {
    expect(() => validateDoublePenaltyFormula('process.exit(1)')).toThrow(BadRequestException);
  });
});

// ── grammar columns (migration 0143) ─────────────────────────────────────────
// `tf_config.targetValues` was read only for is_system rows, so an org-authored
// ruleset had nowhere to declare its targets or whether it uses afterblow.

describe('grammarColumns', () => {
  it('maps only the fields the caller actually sent', () => {
    expect(grammarColumns({})).toEqual({});
    expect(grammarColumns({ targets: [{ name: 'Head', value: 3 }] })).toEqual({
      targets: [{ name: 'Head', value: 3 }],
    });
  });

  it('clears the mode when afterblow is turned off', () => {
    // A mode without the concept is meaningless, and a stale one would seed a
    // tournament with a setting this ruleset's grammar cannot produce.
    expect(grammarColumns({ hasAfterblow: false })).toEqual({
      has_afterblow: false,
      afterblow_mode: null,
    });
  });

  it('refuses to set a mode while afterblow is being turned off in the same patch', () => {
    expect(grammarColumns({ hasAfterblow: false, afterblowMode: 'deductive' })).toEqual({
      has_afterblow: false,
      afterblow_mode: null,
    });
  });

  it('sets the mode when afterblow is on', () => {
    expect(grammarColumns({ hasAfterblow: true, afterblowMode: 'deductive' })).toEqual({
      has_afterblow: true,
      afterblow_mode: 'deductive',
    });
  });

  it('allows a mode change without restating hasAfterblow', () => {
    expect(grammarColumns({ afterblowMode: 'full' })).toEqual({ afterblow_mode: 'full' });
  });
});
