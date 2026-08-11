import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminPlatformLogService } from './admin-platform-log.service';

const fromMock = vi.fn();
const mockSupabase = { service: { from: fromMock } };
const resolveUsers = vi.fn();

type AwaitableChain = Promise<{ data: unknown; error: unknown }> & Record<string, unknown>;

function makeChain(result: { data: unknown; error: unknown }): AwaitableChain {
  const chain = Promise.resolve(result) as AwaitableChain;
  for (const method of [
    'select',
    'eq',
    'gte',
    'lte',
    'in',
    'or',
    'not',
    // `is` is how the query_error source asks for unresolved rows. Without it
    // that source threw, was caught by the tolerant-source guard, and silently
    // contributed nothing — a green suite asserting against an absent source.
    'is',
    'order',
    'limit',
  ] as const) {
    (chain as Record<string, unknown>)[method] = vi.fn().mockReturnValue(chain);
  }
  return chain;
}

/** Dispatch chains by table; any table not listed returns an empty result. */
function wireTables(tables: Record<string, { data: unknown; error: unknown }>): void {
  fromMock.mockImplementation((table: string) =>
    makeChain(tables[table] ?? { data: [], error: null }),
  );
}

describe('AdminPlatformLogService', () => {
  let service: AdminPlatformLogService;

  beforeEach(() => {
    vi.clearAllMocks();
    resolveUsers.mockResolvedValue(new Map());
    service = new AdminPlatformLogService(mockSupabase as never, { resolveUsers } as never);
  });

  it('merges sources, sorts by occurredAt desc, maps severity, and resolves actors', async () => {
    resolveUsers.mockResolvedValue(
      new Map([
        ['actor-1', { name: 'Super Admin', email: 'admin@myclash.fr' }],
        ['rejecter-1', { name: 'Mod One', email: 'mod@myclash.fr' }],
      ]),
    );
    wireTables({
      ai_data_quality_scans: {
        data: [
          {
            id: 'scan-1',
            actor_user_id: 'actor-1',
            error_message: 'AI provider timeout',
            started_at: '2026-06-03T09:00:00.000Z',
            completed_at: '2026-06-03T10:00:00.000Z',
          },
        ],
        error: null,
      },
      ai_data_quality_findings: {
        data: [
          {
            id: 'find-1',
            finding_type: 'club_duplicate',
            severity: 'critical',
            ai_summary: 'Two clubs look identical',
            created_at: '2026-06-01T10:00:00.000Z',
          },
        ],
        error: null,
      },
      organizer_ai_assistant_drafts: {
        data: [
          {
            id: 'draft-1',
            draft_type: 'pool_plan',
            status: 'rejected',
            error: null,
            actor_user_id: 'actor-1',
            rejected_by_user_id: 'rejecter-1',
            created_at: '2026-06-05T08:00:00.000Z',
            updated_at: '2026-06-05T10:00:00.000Z',
          },
        ],
        error: null,
      },
    });

    const result = await service.list({});

    // Sorted desc: draft (06-05) → scan (06-03) → finding (06-01)
    expect(result.items.map((i) => i.id)).toEqual([
      'ai_draft:draft-1',
      'ai_scan:scan-1',
      'ai_finding:find-1',
    ]);
    expect(result.total).toBe(3);

    const scan = result.items.find((i) => i.id === 'ai_scan:scan-1')!;
    expect(scan.category).toBe('ai_scan');
    expect(scan.severity).toBe('error');
    expect(scan.occurredAt).toBe('2026-06-03T10:00:00.000Z'); // completed_at wins
    expect(scan.detail).toBe('AI provider timeout');
    expect(scan.actorName).toBe('Super Admin');
    expect(scan.href).toBe('/admin/data-quality');

    const finding = result.items.find((i) => i.id === 'ai_finding:find-1')!;
    expect(finding.severity).toBe('error'); // critical → error
    expect(finding.title).toBe('club_duplicate');

    const draft = result.items.find((i) => i.id === 'ai_draft:draft-1')!;
    expect(draft.severity).toBe('warning'); // rejected → warning
    expect(draft.actorName).toBe('Mod One'); // resolved from rejected_by_user_id
  });

  it('with a category filter, queries only that source', async () => {
    wireTables({
      ai_data_quality_scans: {
        data: [
          {
            id: 'scan-9',
            actor_user_id: null,
            error_message: 'boom',
            started_at: '2026-06-03T09:00:00.000Z',
            completed_at: null,
          },
        ],
        error: null,
      },
    });

    const result = await service.list({ category: 'ai_scan' });

    expect(result.items).toHaveLength(1);
    expect(fromMock).toHaveBeenCalledTimes(1);
    expect(fromMock).toHaveBeenCalledWith('ai_data_quality_scans');
    expect(fromMock).not.toHaveBeenCalledWith('ai_usage_log');
    // occurredAt falls back to started_at when completed_at is null
    expect(result.items[0]!.occurredAt).toBe('2026-06-03T09:00:00.000Z');
  });

  it('tolerates a failing source — it contributes 0 rows while others still surface', async () => {
    wireTables({
      ai_data_quality_scans: { data: null, error: { message: 'relation does not exist' } },
      ai_data_quality_findings: {
        data: [
          {
            id: 'find-2',
            finding_type: 'placeholder_name',
            severity: 'high',
            ai_summary: 'Looks like test data',
            created_at: '2026-06-02T10:00:00.000Z',
          },
        ],
        error: null,
      },
    });

    const result = await service.list({});

    expect(result.total).toBe(1);
    expect(result.items[0]!.category).toBe('ai_finding');
    expect(result.items[0]!.severity).toBe('warning'); // high → warning
  });

  it('flags truncation at the per-source cap and clamps/slices pagination', async () => {
    const usage = Array.from({ length: 200 }, (_, i) => ({
      id: `u-${i}`,
      feature: 'organizer_ai_chat',
      model: 'gpt-4o-mini',
      provider: 'openai',
      cost_eur: 0.01,
      // Descending timestamps so slice order is deterministic.
      called_at: new Date(Date.UTC(2026, 5, 1, 0, 0, i)).toISOString(),
    }));
    wireTables({ ai_usage_log: { data: usage, error: null } });

    const page1 = await service.list({ category: 'ai_usage', perPage: '500' });
    expect(page1.truncated).toBe(true);
    expect(page1.total).toBe(200);
    expect(page1.perPage).toBe(100); // clamped from 500
    expect(page1.items).toHaveLength(100);

    const page2 = await service.list({ category: 'ai_usage', perPage: '500', page: '2' });
    expect(page2.items).toHaveLength(100);
    // Page 2 starts where page 1 ended — no overlap.
    expect(page2.items[0]!.id).not.toBe(page1.items[0]!.id);
  });

  it('applies the severity filter across the merged feed', async () => {
    wireTables({
      ai_data_quality_scans: {
        data: [
          {
            id: 'scan-e',
            actor_user_id: null,
            error_message: 'x',
            started_at: '2026-06-03T09:00:00.000Z',
            completed_at: '2026-06-03T09:00:00.000Z',
          },
        ],
        error: null,
      },
      clubs: {
        data: [{ id: 'club-1', name: 'Old Club', archived_at: '2026-06-04T09:00:00.000Z' }],
        error: null,
      },
    });

    const result = await service.list({ severity: 'error' });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.category).toBe('ai_scan');
  });

  it('rejects invalid date filters before querying', async () => {
    await expect(service.list({ from: 'not-a-date' })).rejects.toThrow(BadRequestException);
    expect(fromMock).not.toHaveBeenCalled();
  });

  describe('query_error source', () => {
    const row = {
      id: 'qe-1',
      table_name: 'matches',
      is_rpc: false,
      status: 400,
      pg_code: 'PGRST200',
      severity: 'error',
      sanitized_path: 'matches?select=id,tournaments(name)',
      sanitized_message: 'Could not find a relationship',
      first_seen_at: '2026-07-01T09:00:00.000Z',
      last_seen_at: '2026-08-11T09:00:00.000Z',
      occurrence_count: 412,
    };

    it('reports the count as a NUMBER, never as composed prose', async () => {
      wireTables({ query_error_events: { data: [row], error: null } });

      const result = await service.list({ category: 'query_error' });
      const entry = result.items[0]!;

      expect(entry.occurrenceCount).toBe(412);
      expect(entry.firstSeenAt).toBe('2026-07-01T09:00:00.000Z');
      expect(entry.resolvable).toBe(true);
      // Hard rule 6: any English here would never reach a French operator.
      expect(entry.detail).toBe('Could not find a relationship');
      expect(entry.title).toBe('matches · 400 PGRST200');
    });

    /**
     * A three-week-old defect still firing now belongs at the top of the feed.
     * Sorting on first_seen_at would bury it three weeks down.
     */
    it('orders on last_seen_at, not first_seen_at', async () => {
      wireTables({
        query_error_events: { data: [row], error: null },
        ai_data_quality_scans: {
          data: [
            {
              id: 'scan-a',
              actor_user_id: null,
              error_message: 'x',
              started_at: '2026-07-15T09:00:00.000Z',
              completed_at: '2026-07-15T09:00:00.000Z',
            },
          ],
          error: null,
        },
      });

      const result = await service.list({});
      expect(result.items[0]!.category).toBe('query_error');
    });

    it('carries the row severity through rather than assuming error', async () => {
      wireTables({
        query_error_events: {
          data: [{ ...row, severity: 'warning', pg_code: '23505' }],
          error: null,
        },
      });

      const result = await service.list({ category: 'query_error' });
      expect(result.items[0]!.severity).toBe('warning');
    });

    it('falls back to the sanitised path when there is no message', async () => {
      wireTables({
        query_error_events: { data: [{ ...row, sanitized_message: null }], error: null },
      });

      const result = await service.list({ category: 'query_error' });
      expect(result.items[0]!.detail).toBe('matches?select=id,tournaments(name)');
    });
  });
});
