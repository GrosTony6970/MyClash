import { describe, expect, it, vi } from 'vitest';
import { StaffService } from './staff.service';
import { mockSupabase, scopedTo, writesTo } from '../../common/testing/supabase-chain';

/**
 * The scoring tablet's 20-second heartbeat.
 *
 * Two things happen per beat: a live gauge is stamped onto the Scorekeeper's
 * own row, and a durable per-device report goes out through an RPC. The gauge
 * write must be scoped to the caller's OWN account — the event AND the id —
 * because a tablet posting a beat is the least-privileged caller in the system.
 *
 * The local double this replaced recorded the update patches and the `.eq`
 * calls by hand. `writesTo` and `scopedTo` record the same thing for every
 * write, so that bookkeeping is no longer this file's job.
 *
 * `rpc` stays a local stub: the shared double models `from()` and does not
 * pretend to model stored procedures. Keeping it separate is what makes the
 * seam obvious rather than looking like an oversight.
 */

const req = { cookies: {} } as never;
const EVENT = 'E1';
const ACCOUNT = 'a1';

function harness(
  rpcResult: { data: null; error: { message: string } | null } = { data: null, error: null },
) {
  const supabase = mockSupabase({
    event_staff_accounts: {
      rows: [
        { id: ACCOUNT, event_id: EVENT, display_name: 'Marie' },
        // A second account on the same event, so the id filter decides which
        // row the beat lands on rather than merely being present.
        { id: 'a2', event_id: EVENT, display_name: 'Jean' },
      ],
    },
  });
  const rpcCalls: Array<[string, Record<string, unknown>]> = [];
  const rpc = vi.fn((fn: string, args: Record<string, unknown>) => {
    rpcCalls.push([fn, args]);
    return Promise.resolve(rpcResult);
  });
  const svc = new StaffService(
    { service: { from: supabase.from, rpc } } as never,
    {} as never,
    {} as never,
    {} as never,
  );
  vi.spyOn(
    svc as never as { requireStaffFromRequest: () => Promise<{ id: string; event_id: string }> },
    'requireStaffFromRequest',
  ).mockResolvedValue({ id: ACCOUNT, event_id: EVENT });
  const updates = () =>
    writesTo(supabase, 'event_staff_accounts').map((w) => w.row as Record<string, unknown>);
  const beats = () => writesTo(supabase, 'event_staff_accounts');
  return { svc, supabase, rpcCalls, updates, beats };
}

describe('StaffService.recordHeartbeat', () => {
  it('stamps the metrics + last_seen_at, scoped to the caller staff account', async () => {
    const { svc, updates, beats } = harness();

    await expect(
      svc.recordHeartbeat(req, { outboxDepth: 3, oldestPendingAgeSec: 42, rejectedCount: 1 }),
    ).resolves.toEqual({ ok: true });

    expect(updates()[0]).toMatchObject({
      outbox_depth: 3,
      oldest_pending_age_seconds: 42,
      rejected_count: 1,
    });
    expect(typeof updates()[0]!['last_seen_at']).toBe('string');

    // The write must be scoped to the caller's OWN account — both the event
    // and the account id — never a cross-event or cross-account write.
    expect(scopedTo(beats()[0], 'event_id')).toBe(EVENT);
    expect(scopedTo(beats()[0], 'id')).toBe(ACCOUNT);
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
      expect(updates()[0]).toMatchObject({ clock_skew_ms: 90_000 });

      // And BEHIND, which must stay negative — the direction is what says
      // whether bouts were recorded too long or too short.
      await svc.recordHeartbeat(req, {
        outboxDepth: 0,
        oldestPendingAgeSec: 0,
        rejectedCount: 0,
        clientNowMs: Date.parse('2026-08-08T09:58:00.000Z'),
      });
      expect(updates()[1]).toMatchObject({ clock_skew_ms: -120_000 });
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

    expect(updates()[0]).not.toHaveProperty('clock_skew_ms');
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
    // Telemetry must not break scoring: a failed report is logged, not thrown.
    const { svc } = harness({ data: null, error: { message: 'boom' } });

    await expect(
      svc.recordHeartbeat(req, {
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
