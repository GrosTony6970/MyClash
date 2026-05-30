/**
 * notifications-summary.service.test.ts
 *
 * One happy-path test that proves the aggregation:
 *   - reviewQueue from ReviewQueueService.countPending()
 *   - broadcastFailures from event_broadcast_recipients
 *   - aiFindings from ai_data_quality_findings (open + critical/high)
 *   - aiScanCrashes from ai_data_quality_scans (failed)
 *   - total = sum
 * Plus a tolerance check that one failing source doesn't poison the rest.
 */

import { describe, expect, it, vi } from 'vitest';
import { NotificationsSummaryService } from './notifications-summary.service';

function makeChain(result: { count: number | null; error: { message: string } | null }) {
  // Match the Supabase head-count call shape:
  //   .from(table).select('id', { count: 'exact', head: true })
  //     .eq(col, val) [.in(col, [...])]?
  // The terminal awaitable returns { count, error, data: null }.
  const terminal = Promise.resolve({ ...result, data: null });
  const chain: Record<string, unknown> = {};
  Object.assign(chain, {
    select: vi.fn().mockReturnValue(chain),
    eq: vi.fn().mockReturnValue(chain),
    in: vi.fn().mockReturnValue(chain),
    then: terminal.then.bind(terminal),
  });
  return chain;
}

describe('NotificationsSummaryService', () => {
  it('aggregates counts from review queue + broadcasts + AI findings + AI scan crashes', async () => {
    const reviewQueueStub = { countPending: vi.fn().mockResolvedValue(3) };

    const fromMock = vi.fn((table: string) => {
      if (table === 'event_broadcast_recipients') {
        return makeChain({ count: 2, error: null });
      }
      if (table === 'ai_data_quality_findings') {
        return makeChain({ count: 1, error: null });
      }
      if (table === 'ai_data_quality_scans') {
        return makeChain({ count: 4, error: null });
      }
      throw new Error(`unexpected table: ${table}`);
    });
    const supabase = { service: { from: fromMock } };

    const service = new NotificationsSummaryService(supabase as never, reviewQueueStub as never);

    const summary = await service.getSummary();

    expect(summary).toEqual({
      reviewQueue: 3,
      broadcastFailures: 2,
      aiFindings: 1,
      aiScanCrashes: 4,
      total: 10,
    });
    expect(reviewQueueStub.countPending).toHaveBeenCalledOnce();
  });

  it('tolerates a missing data source — the failing count becomes 0, surviving counts surface', async () => {
    // Simulate ai_data_quality_findings table missing on a partial
    // fresh deploy. The bell must still surface the other counts
    // rather than 500-ing.
    const reviewQueueStub = { countPending: vi.fn().mockResolvedValue(5) };

    const fromMock = vi.fn((table: string) => {
      if (table === 'event_broadcast_recipients') return makeChain({ count: 1, error: null });
      if (table === 'ai_data_quality_findings') {
        return makeChain({ count: null, error: { message: 'relation does not exist' } });
      }
      if (table === 'ai_data_quality_scans') return makeChain({ count: 2, error: null });
      throw new Error(`unexpected table: ${table}`);
    });
    const supabase = { service: { from: fromMock } };

    const service = new NotificationsSummaryService(supabase as never, reviewQueueStub as never);

    const summary = await service.getSummary();
    expect(summary.aiFindings).toBe(0);
    expect(summary.total).toBe(5 + 1 + 0 + 2);
  });
});
