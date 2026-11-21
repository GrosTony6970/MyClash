import { describe, expect, it, vi } from 'vitest';
import { StaffService } from './staff.service';
import type { ZodType } from 'zod';
import { StaffHeartbeatDto } from './dto';
import { mockSupabase, selectsFor } from '../../common/testing/supabase-chain';

/**
 * Two tablets on one piste (ruling 953). The check-in says which piste the pad
 * has open; its answer says how many OTHER tablets checked in from that piste
 * in the last minute, for the pad's banner.
 */
const req = { cookies: {} } as never;
const EVENT = 'E1';
const NOW = Date.parse('2026-08-08T10:00:00.000Z');
const ago = (s: number) => new Date(NOW - s * 1000).toISOString();

function harness(reports: Array<Record<string, unknown>>) {
  const supabase = mockSupabase({
    event_staff_accounts: { rows: [{ id: 'a1', event_id: EVENT }] },
    scoring_device_sync_reports: { rows: reports },
  });
  const rpcCalls: Array<[string, Record<string, unknown>]> = [];
  const rpc = vi.fn((fn: string, args: Record<string, unknown>) => {
    rpcCalls.push([fn, args]);
    return Promise.resolve({ data: null, error: null });
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
  ).mockResolvedValue({ id: 'a1', event_id: EVENT });
  return { svc, supabase, rpcCalls };
}

const beat = (over: Record<string, unknown> = {}) => ({
  outboxDepth: 0,
  oldestPendingAgeSec: 0,
  rejectedCount: 0,
  deviceId: 'dev-a',
  quarantinedCount: 0,
  reasonCodes: [],
  oldestQuarantinedAt: null,
  liceId: 'lice-1',
  ...over,
});

describe('the check-in schema', () => {
  it('reads a piste id that is no id as none, and still takes the check-in', () => {
    const schema = (StaffHeartbeatDto as unknown as { schema: ZodType }).schema;
    const parsed = schema.safeParse(beat({ liceId: 'not-a-piste' }));
    expect(parsed.success).toBe(true);
    expect((parsed.data as { liceId: unknown }).liceId).toBeNull();
    expect(
      schema.safeParse(beat({ liceId: '1b4e28ba-2fa1-41d2-883f-0016d3cca427' })).data,
    ).toMatchObject({
      liceId: '1b4e28ba-2fa1-41d2-883f-0016d3cca427',
    });
  });
});

describe('StaffService.recordHeartbeat — the other tablets on the piste', () => {
  it('records the piste the pad has open with the device report', async () => {
    const { svc, rpcCalls } = harness([]);
    vi.useFakeTimers({ now: NOW });
    try {
      await svc.recordHeartbeat(req, beat());
    } finally {
      vi.useRealTimers();
    }
    expect(rpcCalls[0]![1]['p_lice_id']).toBe('lice-1');
  });

  it('counts the other devices heard from on that piste in the last minute', async () => {
    const { svc, supabase } = harness([
      // This pad itself.
      { event_id: EVENT, device_id: 'dev-a', lice_id: 'lice-1', last_reported_at: ago(5) },
      // Another tablet on the piste.
      { event_id: EVENT, device_id: 'dev-b', lice_id: 'lice-1', last_reported_at: ago(30) },
      // Gone quiet more than a minute ago.
      { event_id: EVENT, device_id: 'dev-c', lice_id: 'lice-1', last_reported_at: ago(90) },
      // Another piste, and another Event.
      { event_id: EVENT, device_id: 'dev-d', lice_id: 'lice-2', last_reported_at: ago(5) },
      { event_id: 'E2', device_id: 'dev-e', lice_id: 'lice-1', last_reported_at: ago(5) },
    ]);
    vi.useFakeTimers({ now: NOW });
    try {
      await expect(svc.recordHeartbeat(req, beat())).resolves.toEqual({
        ok: true,
        otherTablets: 1,
      });
    } finally {
      vi.useRealTimers();
    }
    // The mock ignores the projection: pin it.
    expect(selectsFor(supabase.from, 'scoring_device_sync_reports')).toEqual(['device_id']);
  });

  it('counts none for a pad on no piste, or with no device id', async () => {
    const reports = [
      { event_id: EVENT, device_id: 'dev-b', lice_id: 'lice-1', last_reported_at: ago(5) },
    ];
    vi.useFakeTimers({ now: NOW });
    try {
      await expect(
        harness(reports).svc.recordHeartbeat(req, beat({ liceId: null })),
      ).resolves.toEqual({ ok: true, otherTablets: 0 });
      await expect(
        harness(reports).svc.recordHeartbeat(req, beat({ deviceId: undefined })),
      ).resolves.toEqual({ ok: true, otherTablets: 0 });
    } finally {
      vi.useRealTimers();
    }
  });
});
