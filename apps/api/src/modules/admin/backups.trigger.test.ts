import { ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AdminBackupsService } from './backups.service';

/**
 * A backup started by hand writes one audit row (slice 4 of the ops agent: every action of the
 * agent's door is in the audit log under its own account, and the console's button shares the
 * service). In a file of its own: backups.service.test.ts is near the 400-line budget.
 */
function harness(answer: Response) {
  const inserts: Record<string, unknown>[] = [];
  const supabase = {
    service: {
      from: vi.fn((table: string) => ({
        insert: vi.fn((row: Record<string, unknown>) => {
          inserts.push({ table, ...row });
          return Promise.resolve({ error: null });
        }),
      })),
    },
  };
  const service = new AdminBackupsService({
    opsRunnerUrl: 'http://ops-runner:4075',
    opsRunnerSecret: 'secret',
    fetchImpl: vi.fn(async () => answer) as unknown as typeof fetch,
    supabase: supabase as never,
  });
  return { service, inserts };
}

const started = () =>
  new Response(
    JSON.stringify({
      operation: { id: 'op-1', kind: 'backup', status: 'running', startedAt: 'now', logTail: [] },
    }),
    { status: 202, headers: { 'content-type': 'application/json' } },
  );

describe('AdminBackupsService.triggerBackup', () => {
  it('writes one audit row whose actor is the caller', async () => {
    const { service, inserts } = harness(started());
    const result = await service.triggerBackup('u1');
    expect(result.operation.id).toBe('op-1');
    expect(inserts).toEqual([
      expect.objectContaining({
        table: 'audit_log',
        actor_user_id: 'u1',
        action: 'system.backup.run',
        entity_type: 'system_backup',
        entity_id: 'op-1',
      }),
    ]);
  });

  it('a busy runner is a 409 ops_busy, and no audit row', async () => {
    const { service, inserts } = harness(
      new Response(JSON.stringify({ error: 'busy', code: 'ops_busy' }), { status: 409 }),
    );
    const error = await service.triggerBackup('u1').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toMatchObject({ code: 'ops_busy' });
    expect(inserts).toEqual([]);
  });

  it('a service built without a database client refuses rather than skip the audit', async () => {
    const service = new AdminBackupsService({
      opsRunnerUrl: 'http://ops-runner:4075',
      opsRunnerSecret: 'secret',
      fetchImpl: vi.fn(async () => started()) as unknown as typeof fetch,
    });
    await expect(service.triggerBackup('u1')).rejects.toThrow(/audit/u);
  });
});
