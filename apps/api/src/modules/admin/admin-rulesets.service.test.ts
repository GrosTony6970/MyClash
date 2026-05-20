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

  it('bulk-approves a batch and writes a single batch audit entry', async () => {
    const updates: { eqId: string }[] = [];
    const audits: Record<string, unknown>[] = [];
    fromMock.mockImplementation((table: string) => {
      if (table === 'audit_log') {
        return {
          insert: vi.fn((payload: Record<string, unknown>) => {
            audits.push(payload);
            return Promise.resolve({ data: null, error: null });
          }),
        };
      }
      const chain = makeChain({ data: null, error: null });
      chain.update.mockImplementation(() => ({
        eq: vi.fn((_col: string, id: string) => {
          updates.push({ eqId: id });
          return Promise.resolve({ data: null, error: null });
        }),
      }));
      return chain;
    });

    const result = await service.bulkApprove(['r1', 'r2', 'r3'], 'actor');

    expect(result.succeeded).toBe(3);
    expect(result.failed).toBe(0);
    expect(updates.map((u) => u.eqId)).toEqual(['r1', 'r2', 'r3']);
    expect(audits.some((a) => a['action'] === 'ruleset.bulk_approve')).toBe(true);
  });

  it('bulk-reject rejects when reason is empty', async () => {
    await expect(service.bulkReject(['r1'], '   ', 'actor')).rejects.toThrow(BadRequestException);
  });
});
