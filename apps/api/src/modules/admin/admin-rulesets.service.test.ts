import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminRulesetsService } from './admin-rulesets.service';

const fromMock = vi.fn();

const mockSupabase = {
  service: { from: fromMock },
};

function makeChain(result: { data: unknown; error: unknown }) {
  const chain = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    update: vi.fn(),
    insert: vi.fn(),
  };
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.order.mockResolvedValue(result);
  chain.update.mockReturnValue(chain);
  chain.insert.mockResolvedValue({ data: null, error: null });
  return chain;
}

describe('AdminRulesetsService', () => {
  let service: AdminRulesetsService;

  beforeEach(() => {
    vi.clearAllMocks();
    fromMock.mockReturnValue(makeChain({ data: [], error: null }));
    service = new AdminRulesetsService(mockSupabase as never);
  });

  it('approves a ruleset submission and writes audit log', async () => {
    const rulesetChain = makeChain({ data: null, error: null });
    const auditChain = { insert: vi.fn().mockResolvedValue({ data: null, error: null }) };
    fromMock.mockImplementation((table: string) =>
      table === 'ruleset_submissions' ? rulesetChain : auditChain,
    );

    await service.approveRuleset('ruleset-1', 'actor-user');

    expect(rulesetChain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'approved',
        reviewed_by_user_id: 'actor-user',
        rejection_reason: null,
      }),
    );
    expect(auditChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'ruleset.approve', entity_id: 'ruleset-1' }),
    );
  });

  it('rejects a ruleset submission with a required reason', async () => {
    await expect(service.rejectRuleset('ruleset-1', { reason: ' ' }, 'actor')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('lists ruleset submissions without importing submitted code', async () => {
    const result = await service.listRulesets({ status: 'pending' });

    expect(result).toEqual([]);
    expect(fromMock).toHaveBeenCalledWith('ruleset_submissions');
  });
});
