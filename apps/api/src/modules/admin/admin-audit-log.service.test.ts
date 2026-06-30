import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminAuditLogService } from './admin-audit-log.service';

const fromMock = vi.fn();
const mockSupabase = { service: { from: fromMock } };

type AwaitableChain = Promise<{ data: unknown; error: unknown; count?: number | null }> & {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  gte: ReturnType<typeof vi.fn>;
  lte: ReturnType<typeof vi.fn>;
  in: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  range: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
};

function makeAwaitableChain(result: {
  data: unknown;
  error: unknown;
  count?: number | null;
}): AwaitableChain {
  const chain = Promise.resolve(result) as AwaitableChain;
  for (const method of ['select', 'eq', 'gte', 'lte', 'in', 'order', 'range', 'limit'] as const) {
    (chain as unknown as Record<string, unknown>)[method] = vi.fn().mockReturnValue(chain);
  }
  return chain;
}

describe('AdminAuditLogService', () => {
  let service: AdminAuditLogService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AdminAuditLogService(
      mockSupabase as never,
      {
        resolveUsers: vi.fn().mockResolvedValue(new Map()),
      } as never,
    );
  });

  it('applies filters, clamps page size, returns pagination metadata, and enriches entityLabel', async () => {
    const auditChain = makeAwaitableChain({
      data: [
        {
          id: 'log-1',
          actor_user_id: 'actor-1',
          action: 'fighter.merge',
          entity_type: 'fighter',
          entity_id: 'fighter-1',
          payload_json: { reason: 'duplicate' },
          created_at: '2026-05-03T10:00:00.000Z',
        },
      ],
      error: null,
      count: 151,
    });
    const fighterChain = makeAwaitableChain({
      data: [
        {
          id: 'fighter-1',
          display_name: 'Alice Smith',
          given_name: 'Alice',
          family_name: 'Smith',
        },
      ],
      error: null,
    });
    fromMock.mockImplementation((table: string) => {
      if (table === 'audit_log') return auditChain;
      if (table === 'global_persons') return fighterChain;
      throw new Error(`Unexpected table: ${table}`);
    });

    const result = await service.list({
      actor: 'actor-1',
      action: 'fighter.merge',
      entityType: 'fighter',
      from: '2026-05-01',
      to: '2026-05-03',
      page: '2',
      perPage: '500',
    });

    expect(fromMock).toHaveBeenCalledWith('audit_log');
    expect(fromMock).toHaveBeenCalledWith('global_persons');
    expect(auditChain.select).toHaveBeenCalledWith(
      'id, actor_user_id, action, entity_type, entity_id, payload_json, created_at',
      { count: 'exact' },
    );
    expect(auditChain.eq).toHaveBeenCalledWith('actor_user_id', 'actor-1');
    expect(auditChain.eq).toHaveBeenCalledWith('action', 'fighter.merge');
    expect(auditChain.eq).toHaveBeenCalledWith('entity_type', 'fighter');
    expect(auditChain.gte).toHaveBeenCalledWith('created_at', '2026-05-01');
    expect(auditChain.lte).toHaveBeenCalledWith('created_at', '2026-05-03');
    expect(auditChain.order).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(auditChain.range).toHaveBeenCalledWith(100, 199);
    expect(fighterChain.in).toHaveBeenCalledWith('id', ['fighter-1']);
    expect(result).toEqual({
      items: [
        {
          id: 'log-1',
          actor_user_id: 'actor-1',
          actorName: null,
          actorEmail: null,
          action: 'fighter.merge',
          entity_type: 'fighter',
          entity_id: 'fighter-1',
          payload_json: { reason: 'duplicate' },
          created_at: '2026-05-03T10:00:00.000Z',
          entityLabel: 'Alice Smith',
        },
      ],
      total: 151,
      page: 2,
      perPage: 100,
      totalPages: 2,
    });
  });

  it('resolves entityLabel per type and falls back to null for unknown types', async () => {
    const auditChain = makeAwaitableChain({
      data: [
        {
          id: 'log-evt',
          actor_user_id: 'actor-1',
          action: 'event.publish',
          entity_type: 'event',
          entity_id: 'event-1',
          payload_json: null,
          created_at: '2026-05-03T10:00:00.000Z',
        },
        {
          id: 'log-mystery',
          actor_user_id: 'actor-1',
          action: 'something.happened',
          entity_type: 'unmapped_type',
          entity_id: 'unknown-1',
          payload_json: null,
          created_at: '2026-05-03T11:00:00.000Z',
        },
      ],
      error: null,
      count: 2,
    });
    const eventChain = makeAwaitableChain({
      data: [{ id: 'event-1', name: 'Spring Open 2026' }],
      error: null,
    });
    fromMock.mockImplementation((table: string) => {
      if (table === 'audit_log') return auditChain;
      if (table === 'events') return eventChain;
      throw new Error(`Unexpected table: ${table}`);
    });

    const result = await service.list({});

    expect(result.items[0]).toMatchObject({
      entity_type: 'event',
      entityLabel: 'Spring Open 2026',
    });
    expect(result.items[1]).toMatchObject({
      entity_type: 'unmapped_type',
      entityLabel: null,
    });
  });

  it('exports filtered rows as escaped CSV capped at 5000 rows', async () => {
    const chain = makeAwaitableChain({
      data: [
        {
          created_at: '2026-05-03T10:00:00.000Z',
          actor_user_id: 'actor,1',
          action: 'feature_flag.upsert',
          entity_type: 'feature_flag',
          entity_id: 'flag"one',
          payload_json: { text: 'line\nbreak' },
        },
      ],
      error: null,
    });
    fromMock.mockReturnValue(chain);

    const csv = await service.exportCsv({
      action: 'feature_flag.upsert',
      entityType: 'feature_flag',
    });

    expect(chain.eq).toHaveBeenCalledWith('action', 'feature_flag.upsert');
    expect(chain.eq).toHaveBeenCalledWith('entity_type', 'feature_flag');
    expect(chain.limit).toHaveBeenCalledWith(5000);
    expect(csv).toBe(
      [
        'created_at,actor_user_id,action,entity_type,entity_id,payload_json',
        '2026-05-03T10:00:00.000Z,"actor,1",feature_flag.upsert,feature_flag,"flag""one","{""text"":""line\\nbreak""}"',
      ].join('\n'),
    );
  });

  it('rejects invalid date filters', async () => {
    await expect(service.list({ from: 'not-a-date' })).rejects.toThrow(BadRequestException);
    expect(fromMock).not.toHaveBeenCalled();
  });
});
