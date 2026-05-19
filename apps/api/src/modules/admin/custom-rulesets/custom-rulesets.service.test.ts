import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

const validFormula = {
  type: 'binop' as const,
  op: '-' as const,
  left: { type: 'var' as const, name: 'victories' as const },
  right: { type: 'var' as const, name: 'losses' as const },
};
const validConstants = { pointsPerVictory: 3, pointsPerTie: 1, pointsPerLoss: 0, doublePenalty: 0 };
const validTiebreakers = [{ variable: 'victories' as const, direction: 'desc' as const }];

describe('CustomRulesetsService', () => {
  let service: CustomRulesetsService;

  beforeEach(() => {
    vi.clearAllMocks();
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

  it('refuses to edit a system ruleset', async () => {
    fromMock.mockReturnValue(
      makeChain({ data: { id: 'r1', is_system: true, is_default: true }, error: null }),
    );

    await expect(service.update('r1', { name: 'New name' }, 'actor-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
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
});
