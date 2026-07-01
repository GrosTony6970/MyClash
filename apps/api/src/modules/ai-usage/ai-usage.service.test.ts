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
