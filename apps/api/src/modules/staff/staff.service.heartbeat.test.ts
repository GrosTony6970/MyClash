import { describe, expect, it, vi } from 'vitest';
import { StaffService } from './staff.service';

const req = { cookies: {} } as never;

function harness() {
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
  const svc = new StaffService({ service } as never, {} as never, {} as never, {} as never);
  vi.spyOn(
    svc as never as { requireStaffFromRequest: () => Promise<{ id: string; event_id: string }> },
    'requireStaffFromRequest',
  ).mockResolvedValue({ id: 'a1', event_id: 'E1' });
  return { svc, updates, eqCalls };
}

describe('StaffService.recordHeartbeat', () => {
  it('stamps the metrics + last_seen_at, scoped to the caller staff account', async () => {
    const { svc, updates, eqCalls } = harness();

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

  it('records a signed clock skew from the tablet clock', async () => {
    const { svc, updates } = harness();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-08T10:00:00.000Z'));
    try {
      // Tablet is 90s AHEAD of the server.
      await svc.recordHeartbeat(req, {
        outboxDepth: 0,
        oldestPendingAgeSec: 0,
        rejectedCount: 0,
        clientNowMs: Date.parse('2026-08-08T10:01:30.000Z'),
      });
      expect(updates[0]).toMatchObject({ clock_skew_ms: 90_000 });

      // And BEHIND, which must stay negative — the direction is what says
      // whether bouts were recorded too long or too short.
      await svc.recordHeartbeat(req, {
        outboxDepth: 0,
        oldestPendingAgeSec: 0,
        rejectedCount: 0,
        clientNowMs: Date.parse('2026-08-08T09:58:00.000Z'),
      });
      expect(updates[1]).toMatchObject({ clock_skew_ms: -120_000 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('leaves the column untouched when the tablet sends no clock', async () => {
    const { svc, updates } = harness();

    // An older bundle mid-event still heartbeats. Writing 0 here would render
    // as a verified-good clock on the board, which is worse than no reading.
    await svc.recordHeartbeat(req, {
      outboxDepth: 0,
      oldestPendingAgeSec: 0,
      rejectedCount: 0,
    });

    expect(updates[0]).not.toHaveProperty('clock_skew_ms');
  });
});
