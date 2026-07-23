import { describe, expect, it, vi } from 'vitest';
import { StaffService } from './staff.service';

const req = { cookies: {} } as never;

describe('StaffService.recordHeartbeat', () => {
  it('stamps the metrics + last_seen_at, scoped to the caller staff account', async () => {
    const updates: Record<string, unknown>[] = [];
    const eqCalls: Array<[string, unknown]> = [];
    const service = {
      from: vi.fn(() => {
        const chain: Record<string, unknown> = {
          update: vi.fn((patch: Record<string, unknown>) => {
            updates.push(patch);
            return chain;
          }),
          eq: vi.fn((column: string, value: unknown) => {
            eqCalls.push([column, value]);
            return chain;
          }),
          then: (r: (v: { data: null; error: null }) => void) => r({ data: null, error: null }),
        };
        return chain;
      }),
    };
    const svc = new StaffService({ service } as never, {} as never, {} as never);
    vi.spyOn(
      svc as never as { requireStaffFromRequest: () => Promise<{ id: string; event_id: string }> },
      'requireStaffFromRequest',
    ).mockResolvedValue({ id: 'a1', event_id: 'E1' });

    await expect(
      svc.recordHeartbeat(req, { outboxDepth: 3, oldestPendingAgeSec: 42, rejectedCount: 1 }),
    ).resolves.toEqual({ ok: true });

    expect(updates[0]).toMatchObject({
      outbox_depth: 3,
      oldest_pending_age_seconds: 42,
      rejected_count: 1,
    });
    expect(typeof updates[0]!['last_seen_at']).toBe('string');

    // The write must be scoped to the caller's OWN account — both the event
    // and the account id — never a cross-event or cross-account write.
    expect(eqCalls).toContainEqual(['event_id', 'E1']);
    expect(eqCalls).toContainEqual(['id', 'a1']);
  });
});
