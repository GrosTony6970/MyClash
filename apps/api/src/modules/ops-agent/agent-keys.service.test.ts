import { NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentKeysService } from './agent-keys.service';

const insertAuditLog = vi.fn();
vi.mock('../../common/audit-log', () => ({
  insertAuditLog: (...args: unknown[]) => insertAuditLog(...args),
}));

const ROW = {
  id: '11111111-1111-4111-8111-111111111111',
  label: 'Claude ops agent',
  created_at: '2026-11-18T10:00:00Z',
  last_used_at: null,
  revoked_at: null,
};

const calls: Array<[string, ...unknown[]]> = [];
let listResult: { data: unknown[] | null; error: { message: string } | null };
let revokeResult: { data: unknown; error: { message: string } | null };

/** Records every builder call in order; reads resolve to the seeded results. */
function client() {
  const chain: Record<string, unknown> = {};
  for (const name of ['select', 'order', 'update', 'eq', 'is']) {
    chain[name] = (...args: unknown[]) => {
      calls.push([name, ...args]);
      return chain;
    };
  }
  chain['then'] = (resolve: (v: unknown) => unknown) => Promise.resolve(listResult).then(resolve);
  chain['maybeSingle'] = async () => {
    calls.push(['maybeSingle']);
    return revokeResult;
  };
  return {
    service: {
      from: (table: string) => {
        calls.push(['from', table]);
        return chain;
      },
    },
  };
}

const service = () => new AgentKeysService(client() as never);

beforeEach(() => {
  calls.length = 0;
  insertAuditLog.mockReset().mockResolvedValue({ error: null });
  listResult = { data: [ROW], error: null };
  revokeResult = { data: { ...ROW, revoked_at: '2026-11-18T11:00:00Z' }, error: null };
});

describe('AgentKeysService.list', () => {
  it('reads label and dates, newest first, and never the hash or the account', async () => {
    const rows = await service().list();
    expect(calls).toEqual([
      ['from', 'agent_keys'],
      ['select', 'id, label, created_at, last_used_at, revoked_at'],
      ['order', 'created_at', { ascending: false }],
    ]);
    expect(rows).toEqual([
      {
        id: ROW.id,
        label: 'Claude ops agent',
        createdAt: '2026-11-18T10:00:00Z',
        lastUsedAt: null,
        revokedAt: null,
      },
    ]);
  });
});

describe('AgentKeysService.revoke', () => {
  it('revokes a live key only, and writes one audit row naming the super admin', async () => {
    const row = await service().revoke(ROW.id, 'admin-uuid');
    expect(calls[0]).toEqual(['from', 'agent_keys']);
    expect(calls[1]![0]).toBe('update');
    expect(calls[1]![1]).toEqual({ revoked_at: expect.any(String) });
    expect(calls).toContainEqual(['eq', 'id', ROW.id]);
    expect(calls).toContainEqual(['is', 'revoked_at', null]);
    expect(calls).toContainEqual(['select', 'id, label, created_at, last_used_at, revoked_at']);
    expect(row.revokedAt).toBe('2026-11-18T11:00:00Z');
    expect(insertAuditLog).toHaveBeenCalledTimes(1);
    expect(insertAuditLog.mock.calls[0]![1]).toEqual({
      actorUserId: 'admin-uuid',
      action: 'agent_key.revoke',
      entityType: 'agent_key',
      entityId: ROW.id,
    });
  });

  it('answers 404 for a key already revoked or unknown, and writes no audit row', async () => {
    revokeResult = { data: null, error: null };
    await expect(service().revoke(ROW.id, 'admin-uuid')).rejects.toBeInstanceOf(NotFoundException);
    expect(insertAuditLog).not.toHaveBeenCalled();
  });
});
