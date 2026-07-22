/**
 * Publish-time dry-run validation for org-authored scoring rulesets: the four
 * publish gates (publish / submitForReview / approveForPublic / createForOrg)
 * reject empty grammar, an unresolvable coded base, or a formula that can score
 * to a non-finite value — before a broken ruleset can be used or shared.
 *
 * Split out of custom-rulesets.service.test.ts to keep each file under the
 * 400-line cap.
 */
import { BadRequestException } from '@nestjs/common';
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
  (chain as { then: unknown }).then = (resolve: (value: unknown) => unknown) => resolve(result);
  return chain;
}

const validConstants = { pointsPerVictory: 3, pointsPerTie: 1, pointsPerLoss: 0, doublePenalty: 0 };
const validTiebreakers = [{ variable: 'victories' as const, direction: 'desc' as const }];

// score = pointsPerVictory * victories (valid AST; overflows if the constant
// is pathologically large).
const LINEAR_AST = {
  type: 'binop',
  op: '*',
  left: { type: 'var', name: 'pointsPerVictory' },
  right: { type: 'var', name: 'victories' },
};

const formulaRow = (over: Record<string, unknown> = {}) => ({
  id: 'r1',
  code: 'custom_x',
  version: '1.0.0',
  name: 'X',
  description: null,
  status: 'draft',
  score_formula: LINEAR_AST,
  constants: validConstants,
  tiebreakers: validTiebreakers,
  match_format_defaults: null,
  double_penalty_formula: null,
  tf_config: null,
  targets: [{ name: 'Hit', value: 1 }],
  has_afterblow: false,
  afterblow_mode: null,
  afterblow_valuation: null,
  afterblow_fixed_value: null,
  is_default: false,
  is_system: false,
  owner_organization_id: 'org-1',
  public_visibility: false,
  submitted_for_review_at: null,
  rejected_reason: null,
  base_code: null,
  base_version: null,
  created_by_user_id: 'u',
  created_at: '',
  updated_at: '',
  ...over,
});

describe('CustomRulesetsService — publish-time dry-run validation', () => {
  let service: CustomRulesetsService;

  beforeEach(() => {
    vi.clearAllMocks();
    if (!registry.has(TF_v1.code, TF_v1.version)) registry.register(TF_v1);
    service = new CustomRulesetsService(mockSupabase as never);
  });

  it('publish rejects a ruleset with no scoring targets', async () => {
    fromMock.mockReturnValue(makeChain({ data: formulaRow({ targets: [] }), error: null }));
    await expect(service.publish('r1', 'actor')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('publish rejects a formula that can score to a non-finite value', async () => {
    fromMock.mockReturnValue(
      makeChain({
        data: formulaRow({ constants: { ...validConstants, pointsPerVictory: 1e308 } }),
        error: null,
      }),
    );
    await expect(service.publish('r1', 'actor')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('publish allows a valid formula ruleset', async () => {
    fromMock.mockReturnValue(makeChain({ data: formulaRow(), error: null }));
    await expect(service.publish('r1', 'actor')).resolves.toMatchObject({ id: 'r1' });
  });

  it('submitForReview rejects a broken ruleset before it enters the review queue', async () => {
    fromMock.mockReturnValue(makeChain({ data: formulaRow({ targets: null }), error: null }));
    await expect(service.submitForReview('r1', 'actor')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('submitForReview accepts a coded fork whose base still resolves (skips the formula dry-run)', async () => {
    fromMock.mockReturnValue(
      makeChain({
        data: formulaRow({ base_code: 'TF_v1', base_version: '1.0.0', score_formula: {} }),
        error: null,
      }),
    );
    await expect(service.submitForReview('r1', 'actor')).resolves.toMatchObject({ id: 'r1' });
  });

  it('submitForReview rejects a coded fork whose base is no longer registered', async () => {
    fromMock.mockReturnValue(
      makeChain({
        data: formulaRow({ base_code: 'TF_gone', base_version: '1.0.0', score_formula: {} }),
        error: null,
      }),
    );
    await expect(service.submitForReview('r1', 'actor')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('approveForPublic re-runs the dry-run at the catalog gate', async () => {
    fromMock.mockReturnValue(
      makeChain({
        data: formulaRow({ submitted_for_review_at: '2026-01-01T00:00:00Z', targets: [] }),
        error: null,
      }),
    );
    await expect(service.approveForPublic('r1', 'actor')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('createForOrg rejects a formula ruleset with no targets', async () => {
    await expect(
      service.createForOrg(
        'org-1',
        {
          name: 'No pad',
          scoreFormula: LINEAR_AST,
          constants: validConstants,
          tiebreakers: validTiebreakers,
        } as never,
        'actor',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('createForOrg rejects a formula that can overflow', async () => {
    await expect(
      service.createForOrg(
        'org-1',
        {
          name: 'Overflow',
          scoreFormula: LINEAR_AST,
          constants: { ...validConstants, pointsPerVictory: 1e308 },
          tiebreakers: validTiebreakers,
          targets: [{ name: 'Hit', value: 1 }],
        } as never,
        'actor',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
