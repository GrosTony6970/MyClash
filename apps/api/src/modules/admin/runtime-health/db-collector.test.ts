import { describe, it, expect } from 'vitest';
import { collectDb } from './db-collector';

function mockSupabase(rpcResult: unknown, error: unknown = null) {
  return { service: { rpc: async () => ({ data: rpcResult, error }) } } as never;
}

describe('collectDb', () => {
  it('maps the rpc jsonb payload', async () => {
    const supabase = mockSupabase({
      maxConnections: 100,
      connectionsByState: { active: 8, idle: 31, idleInTransaction: 3, total: 42 },
      longestQuerySeconds: 2,
      databaseSizeBytes: 1932735283,
      cacheHitRatio: 0.994,
      uptimeSeconds: 1048320,
    });
    const result = await collectDb(supabase);
    expect(result.maxConnections).toBe(100);
    expect(result.connectionsByState.total).toBe(42);
    expect(result.cacheHitRatio).toBe(0.994);
  });

  it('throws when the rpc returns an error', async () => {
    const supabase = mockSupabase(null, { message: 'permission denied' });
    await expect(collectDb(supabase)).rejects.toThrow('permission denied');
  });
});
