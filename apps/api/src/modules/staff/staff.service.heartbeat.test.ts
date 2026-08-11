import { describe, expect, it, vi } from 'vitest';
import { StaffService } from './staff.service';

const req = { cookies: {} } as never;

function harness() {
  const updates: Record<string, unknown>[] = [];
  const eqCalls: Array<[string, unknown]> = [];
  const rpcCalls: Array<[string, Record<string, unknown>]> = [];
  const service = {
    rpc: vi.fn((fn: string, args: Record<string, unknown>) => {
      rpcCalls.push([fn, args]);
      return Promise.resolve({ data: null, error: null });
    }),
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
  return { svc, updates, eqCalls, rpcCalls };
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

describe('StaffService.recordHeartbeat — durable device report', () => {
  const quarantine = {
    outboxDepth: 0,
    oldestPendingAgeSec: 0,
    rejectedCount: 0,
    deviceId: 'dev-a',
    deviceLabel: 'Tablet A',
    quarantinedCount: 3,
    reasonCodes: ['match_closed'] as const,
    oldestQuarantinedAt: '2026-01-01T10:00:00.000Z',
  };

  it('records the quarantine against the event from the SESSION, never the client', async () => {
    const { svc, rpcCalls } = harness();

    await svc.recordHeartbeat(req, { ...quarantine, eventId: 'attacker-event' } as never);

    expect(rpcCalls).toHaveLength(1);
    const [fn, args] = rpcCalls[0]!;
    expect(fn).toBe('record_device_sync_report');
    expect(args['p_event_id']).toBe('E1');
    expect(args['p_quarantined_count']).toBe(3);
    expect(args['p_reason_codes']).toEqual(['match_closed']);
  });

  it('still records when the quarantine is EMPTY, so silence differs from clean', async () => {
    const { svc, rpcCalls } = harness();

    await svc.recordHeartbeat(req, {
      outboxDepth: 0,
      oldestPendingAgeSec: 0,
      rejectedCount: 0,
      deviceId: 'dev-a',
      quarantinedCount: 0,
      reasonCodes: [],
      oldestQuarantinedAt: null,
    });

    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0]![1]['p_quarantined_count']).toBe(0);
  });

  it('skips the report for a tablet on an older bundle, without failing the beat', async () => {
    const { svc, rpcCalls } = harness();

    await expect(
      svc.recordHeartbeat(req, { outboxDepth: 1, oldestPendingAgeSec: 2, rejectedCount: 0 }),
    ).resolves.toEqual({ ok: true });

    expect(rpcCalls).toHaveLength(0);
  });

  it('never fails the heartbeat when the durable write errors', async () => {
    const { svc } = harness();
    // Telemetry must not break scoring: a failed report is logged, not thrown.
    const failing = {
      rpc: vi.fn(() => Promise.resolve({ data: null, error: { message: 'boom' } })),
      from: vi.fn(() => {
        const chain: Record<string, unknown> = {
          update: vi.fn(() => chain),
          eq: vi.fn(() => chain),
          then: (r: (v: { data: null; error: null }) => void) => r({ data: null, error: null }),
        };
        return chain;
      }),
    };
    const svc2 = new StaffService(
      { service: failing } as never,
      {} as never,
      {} as never,
      {} as never,
    );
    vi.spyOn(
      svc2 as never as { requireStaffFromRequest: () => Promise<{ id: string; event_id: string }> },
      'requireStaffFromRequest',
    ).mockResolvedValue({ id: 'a1', event_id: 'E1' });
    void svc;

    await expect(
      svc2.recordHeartbeat(req, {
        outboxDepth: 0,
        oldestPendingAgeSec: 0,
        rejectedCount: 0,
        deviceId: 'dev-a',
        quarantinedCount: 1,
        reasonCodes: ['other'],
        oldestQuarantinedAt: null,
      }),
    ).resolves.toEqual({ ok: true });
  });
});
