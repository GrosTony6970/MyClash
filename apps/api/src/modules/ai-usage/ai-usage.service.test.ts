import { ServiceUnavailableException } from '@nestjs/common';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AIUsageService } from './ai-usage.service';
import { BudgetExceededException } from './budget-exceeded.exception';
import { SpendCapExceededException } from './spend-cap.exception';

const mockProviderGenerate = vi.fn();
const mockAIProviders = { generate: mockProviderGenerate };

const mockIsEnabled = vi.fn();
const mockFlags = { isEnabled: mockIsEnabled };

const fromMock = vi.fn();
const mockSupabase = { service: { from: fromMock } };

function makeChain(result: unknown) {
  const chain = {
    select: vi.fn(),
    eq: vi.fn(),
    gte: vi.fn(),
    lte: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    insert: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue(result),
    single: vi.fn().mockResolvedValue(result),
  };
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.gte.mockReturnValue(chain);
  chain.lte.mockReturnValue(chain);
  chain.order.mockReturnValue(chain);
  chain.limit.mockReturnValue(chain);
  chain.insert.mockReturnValue(chain);
  return chain;
}

const fakeResult = { text: 'ok', inputTokens: 10, outputTokens: 5, costEur: 0.001 };
const baseRequest = { system: 's', user: 'u', model: 'm', maxTokens: 100, temperature: 0 };

describe('AIUsageService.generateWithCap', () => {
  let service: AIUsageService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsEnabled.mockResolvedValue(false);
    service = new AIUsageService(
      mockAIProviders as never,
      mockSupabase as never,
      mockFlags as never,
    );
  });

  it('passes when no cap is set (NULL)', async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === 'events') return makeChain({ data: { ai_spend_cap_eur: null }, error: null });
      return makeChain({ data: null, error: null });
    });
    mockProviderGenerate.mockResolvedValue(fakeResult);

    const result = await service.generateWithCap('org-1', 'event-1', 'nlq', baseRequest);
    expect(result.text).toBe('ok');
    expect(mockProviderGenerate).toHaveBeenCalledOnce();
  });

  it('passes when spend is under cap', async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === 'events') return makeChain({ data: { ai_spend_cap_eur: 5.0 }, error: null });
      if (table === 'ai_usage_log') {
        const chain = makeChain(null);
        chain.single.mockResolvedValue({ data: { sum: '2.50' }, error: null });
        return chain;
      }
      return makeChain({ data: null, error: null });
    });
    mockProviderGenerate.mockResolvedValue(fakeResult);

    const result = await service.generateWithCap('org-1', 'event-1', 'nlq', baseRequest);
    expect(result.text).toBe('ok');
  });

  it('throws SpendCapExceededException when at or over cap', async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === 'events') return makeChain({ data: { ai_spend_cap_eur: 5.0 }, error: null });
      if (table === 'ai_usage_log') {
        const chain = makeChain(null);
        chain.single.mockResolvedValue({ data: { sum: '5.00' }, error: null });
        return chain;
      }
      return makeChain({ data: null, error: null });
    });

    await expect(service.generateWithCap('org-1', 'event-1', 'nlq', baseRequest)).rejects.toThrow(
      SpendCapExceededException,
    );
    expect(mockProviderGenerate).not.toHaveBeenCalled();
  });

  it('inserts usage log row after successful generation', async () => {
    const insertChain = makeChain({ data: null, error: null });
    fromMock.mockImplementation((table: string) => {
      if (table === 'events') return makeChain({ data: { ai_spend_cap_eur: null }, error: null });
      if (table === 'ai_usage_log') return insertChain;
      return makeChain({ data: null, error: null });
    });
    mockProviderGenerate.mockResolvedValue(fakeResult);

    await service.generateWithCap('org-1', 'event-1', 'nlq', baseRequest);
    expect(insertChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        event_id: 'event-1',
        organization_id: 'org-1',
        feature: 'nlq',
        input_tokens: 10,
        output_tokens: 5,
        cost_eur: 0.001,
      }),
    );
  });

  it('throws ServiceUnavailableException when disable_ai_features is on', async () => {
    mockIsEnabled.mockResolvedValue(true);
    fromMock.mockImplementation(() => makeChain({ data: null, error: null }));

    await expect(service.generateWithCap('org-1', 'event-1', 'nlq', baseRequest)).rejects.toThrow(
      ServiceUnavailableException,
    );
    expect(mockProviderGenerate).not.toHaveBeenCalled();
  });

  it('throws BudgetExceededException when the org monthly budget is reached', async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === 'platform_ai_settings')
        return makeChain({ data: { monthly_budget_eur: null }, error: null });
      if (table === 'organization_ai_settings')
        return makeChain({ data: { monthly_budget_eur: 5.0 }, error: null });
      if (table === 'ai_usage_log') {
        const chain = makeChain(null);
        chain.single.mockResolvedValue({ data: { sum: '5.00' }, error: null });
        return chain;
      }
      if (table === 'events') return makeChain({ data: { ai_spend_cap_eur: null }, error: null });
      return makeChain({ data: null, error: null });
    });

    await expect(service.generateWithCap('org-1', 'event-1', 'nlq', baseRequest)).rejects.toThrow(
      BudgetExceededException,
    );
    expect(mockProviderGenerate).not.toHaveBeenCalled();
  });

  it('throws ServiceUnavailableException when the org disabled AI for itself', async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === 'organization_ai_settings')
        return makeChain({
          data: { ai_features_disabled: true, monthly_budget_eur: null },
          error: null,
        });
      return makeChain({ data: null, error: null });
    });

    await expect(service.generateWithCap('org-1', 'event-1', 'nlq', baseRequest)).rejects.toThrow(
      ServiceUnavailableException,
    );
    expect(mockProviderGenerate).not.toHaveBeenCalled();
  });
});

describe('AIUsageService.getUsageSummary', () => {
  let service: AIUsageService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsEnabled.mockResolvedValue(false);
    service = new AIUsageService(
      mockAIProviders as never,
      mockSupabase as never,
      mockFlags as never,
    );
  });

  it('returns totalSpendEur, cap, remainingEur, callCount', async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === 'events') return makeChain({ data: { ai_spend_cap_eur: 10.0 }, error: null });
      if (table === 'ai_usage_log') {
        const chain = makeChain(null);
        chain.single.mockResolvedValue({
          data: { total: '3.50', calls: 7 },
          error: null,
        });
        return chain;
      }
      return makeChain({ data: null, error: null });
    });

    const summary = await service.getUsageSummary('event-1');
    expect(summary.totalSpendEur).toBeCloseTo(3.5);
    expect(summary.cap).toBeCloseTo(10);
    expect(summary.remainingEur).toBeCloseTo(6.5);
    expect(summary.callCount).toBe(7);
  });
});

describe('AIUsageService.getOrgUsageRollup', () => {
  // Thenable ai_usage_log builder that pages by the .range(offset,...) call, so
  // we can verify pagination aggregates across pages (not the old 5000 cap).
  function makeService(allRows: unknown[], nameRows: unknown[] = []) {
    const from = vi.fn((table: string) => {
      if (table === 'ai_usage_log') {
        let offset = 0;
        const b: Record<string, unknown> = {
          select: () => b,
          order: () => b,
          eq: () => b,
          gte: () => b,
          lte: () => b,
          range: (f: number) => {
            offset = f;
            return b;
          },
          then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
            Promise.resolve({ data: allRows.slice(offset, offset + 1000), error: null }).then(
              res,
              rej,
            ),
        };
        return b;
      }
      // events / organizations name lookup
      return { select: () => ({ in: () => Promise.resolve({ data: nameRows, error: null }) }) };
    });
    return new AIUsageService(
      mockAIProviders as never,
      { service: { from } } as never,
      mockFlags as never,
    );
  }

  it('aggregates across multiple pages and resolves event names', async () => {
    const rows = Array.from({ length: 1500 }, () => ({
      organization_id: 'org-1',
      event_id: 'e1',
      feature: 'nlq',
      model: 'claude-opus-4-8',
      provider: 'anthropic',
      input_tokens: 1,
      output_tokens: 1,
      cost_eur: 0.01,
      called_at: '2026-07-01T00:00:00Z',
    }));
    const service = makeService(rows, [{ id: 'e1', name: 'Summer Open' }]);

    const rollup = await service.getOrgUsageRollup('org-1');

    expect(rollup.total.calls).toBe(1500); // both pages counted (would be capped before)
    expect(rollup.total.costEur).toBeCloseTo(15);
    expect(rollup.truncated).toBe(false);
    expect(rollup.byEvent).toHaveLength(1);
    expect(rollup.byEvent[0]?.label).toBe('Summer Open'); // no raw UUID
  });
});
