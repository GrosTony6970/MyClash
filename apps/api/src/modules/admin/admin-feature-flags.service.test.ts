import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminFeatureFlagsService } from './admin-feature-flags.service';

const fromMock = vi.fn();

const mockSupabase = {
  service: { from: fromMock },
};

describe('AdminFeatureFlagsService', () => {
  let service: AdminFeatureFlagsService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AdminFeatureFlagsService(mockSupabase as never);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('lists every registered flag, even when no row exists in the DB', async () => {
    fromMock.mockReturnValue({
      select: vi.fn().mockResolvedValue({ data: [], error: null }),
    });

    const flags = await service.listFlagsWithRegistry();

    // Registry has 11 entries (admin_lockdown + 10 added across features,
    // including disable_public_signups from the global-profile slice,
    // disable_organizer_chat from the organizer chatbot, and time_simulation).
    expect(flags).toHaveLength(11);
    const keys = flags.map((f) => f.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        'admin_lockdown',
        'read_only_mode',
        'disable_signups',
        'disable_public_signups',
        'maintenance_banner',
        'disable_ai_features',
        'disable_organizer_chat',
        'disable_hema_sync',
        'disable_email',
        'time_simulation',
        'disable_realtime',
      ]),
    );
    // All default to false with null timestamp/payload
    for (const flag of flags) {
      expect(flag.enabled).toBe(false);
      expect(flag.updated_at).toBeNull();
      expect(flag.payloadJson).toBeNull();
    }
  });

  it('overlays stored row state onto the registry entries', async () => {
    fromMock.mockReturnValue({
      select: vi.fn().mockResolvedValue({
        data: [
          {
            key: 'admin_lockdown',
            description: 'in maintenance',
            enabled: true,
            payload_json: null,
            updated_at: '2026-05-19T15:00:00Z',
            updated_by_user_id: 'actor-1',
          },
        ],
        error: null,
      }),
    });

    const flags = await service.listFlagsWithRegistry();
    const lockdown = flags.find((f) => f.key === 'admin_lockdown');

    expect(lockdown).toEqual({
      key: 'admin_lockdown',
      enabled: true,
      description: 'in maintenance',
      payloadJson: null,
      updated_at: '2026-05-19T15:00:00Z',
    });
  });

  it('exposes payload_json on the banner flag and hides it on other flags', async () => {
    fromMock.mockReturnValue({
      select: vi.fn().mockResolvedValue({
        data: [
          {
            key: 'maintenance_banner',
            description: null,
            enabled: true,
            payload_json: { message: 'Maintenance at 03:00 UTC', severity: 'warning' },
            updated_at: '2026-05-20T01:00:00Z',
            updated_by_user_id: 'actor-1',
          },
          // Even if a non-payload flag somehow has a row with payload_json,
          // we never expose it in the API response.
          {
            key: 'admin_lockdown',
            description: null,
            enabled: false,
            payload_json: { stowaway: true },
            updated_at: '2026-05-20T01:00:00Z',
            updated_by_user_id: 'actor-1',
          },
        ],
        error: null,
      }),
    });

    const flags = await service.listFlagsWithRegistry();
    const banner = flags.find((f) => f.key === 'maintenance_banner');
    const lockdown = flags.find((f) => f.key === 'admin_lockdown');
    expect(banner?.payloadJson).toEqual({
      message: 'Maintenance at 03:00 UTC',
      severity: 'warning',
    });
    expect(lockdown?.payloadJson).toBeNull();
  });

  it('upserts a known flag and writes the audit log', async () => {
    const flagsChain = {
      upsert: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    const auditChain = {
      insert: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    fromMock.mockImplementation((table: string) =>
      table === 'feature_flags' ? flagsChain : auditChain,
    );

    await service.upsertFlag(
      'admin_lockdown',
      { description: 'Maintenance', enabled: true },
      'actor-user',
    );

    expect(flagsChain.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'admin_lockdown',
        description: 'Maintenance',
        enabled: true,
        payload_json: null,
        updated_by_user_id: 'actor-user',
      }),
    );
    expect(auditChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'feature_flag.upsert',
        entity_id: 'admin_lockdown',
      }),
    );
  });

  it('rejects upserts for unknown flag keys', async () => {
    await expect(
      service.upsertFlag('not_a_real_flag', { enabled: true }, 'actor-user'),
    ).rejects.toThrow(/Unknown feature flag/);
  });

  it('persists a valid payload_json for the banner flag', async () => {
    const flagsChain = {
      upsert: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    fromMock.mockImplementation((table: string) =>
      table === 'feature_flags'
        ? flagsChain
        : { insert: vi.fn().mockResolvedValue({ data: null, error: null }) },
    );

    await service.upsertFlag(
      'maintenance_banner',
      {
        enabled: true,
        payloadJson: { message: 'Saturday maintenance', severity: 'info' },
      },
      'actor-user',
    );

    expect(flagsChain.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'maintenance_banner',
        payload_json: { message: 'Saturday maintenance', severity: 'info' },
      }),
    );
  });

  it('persists a valid payload_json for the time_simulation flag', async () => {
    const flagsChain = {
      upsert: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    fromMock.mockImplementation((table: string) =>
      table === 'feature_flags'
        ? flagsChain
        : { insert: vi.fn().mockResolvedValue({ data: null, error: null }) },
    );

    await service.upsertFlag(
      'time_simulation',
      {
        enabled: true,
        payloadJson: {
          simulatedNowIso: '2027-05-22T08:00:00.000Z',
          anchorRealIso: '2026-07-13T12:00:00.000Z',
        },
      },
      'actor-user',
    );

    expect(flagsChain.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'time_simulation',
        payload_json: {
          simulatedNowIso: '2027-05-22T08:00:00.000Z',
          anchorRealIso: '2026-07-13T12:00:00.000Z',
        },
      }),
    );
  });

  it('rejects malformed time_simulation payloads', async () => {
    fromMock.mockImplementation(() => ({
      upsert: vi.fn().mockResolvedValue({ data: null, error: null }),
      insert: vi.fn().mockResolvedValue({ data: null, error: null }),
    }));

    await expect(
      service.upsertFlag(
        'time_simulation',
        { enabled: true, payloadJson: { simulatedNowIso: 'not-a-date' } as never },
        'actor-user',
      ),
    ).rejects.toThrow(/time_simulation payload/);
  });

  it('rejects malformed banner payloads', async () => {
    fromMock.mockImplementation(() => ({
      upsert: vi.fn().mockResolvedValue({ data: null, error: null }),
      insert: vi.fn().mockResolvedValue({ data: null, error: null }),
    }));

    await expect(
      service.upsertFlag(
        'maintenance_banner',
        { enabled: true, payloadJson: { message: '', severity: 'plaid' } as never },
        'actor-user',
      ),
    ).rejects.toThrow(/maintenance_banner payload/);
  });

  it('silently drops payload_json for flags that did not opt in', async () => {
    const flagsChain = {
      upsert: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    fromMock.mockImplementation((table: string) =>
      table === 'feature_flags'
        ? flagsChain
        : { insert: vi.fn().mockResolvedValue({ data: null, error: null }) },
    );

    await service.upsertFlag(
      'admin_lockdown',
      {
        enabled: true,
        payloadJson: { stowaway: 'data' },
      },
      'actor-user',
    );

    expect(flagsChain.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'admin_lockdown',
        payload_json: null,
      }),
    );
  });

  describe('getPublicFlagsSnapshot', () => {
    it('returns the empty default when no rows are stored', async () => {
      fromMock.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        in: vi.fn().mockResolvedValue({ data: [], error: null }),
      });

      const snap = await service.getPublicFlagsSnapshot();
      expect(snap).toEqual({
        maintenanceBanner: { enabled: false, message: null, severity: null },
        realtimeDisabled: false,
        timeSimulation: { enabled: false, simulatedNowIso: null, anchorRealIso: null },
      });
    });

    it('includes the banner payload when the banner flag is on', async () => {
      fromMock.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        in: vi.fn().mockResolvedValue({
          data: [
            {
              key: 'maintenance_banner',
              enabled: true,
              payload_json: { message: 'Maintenance Saturday', severity: 'critical' },
            },
            { key: 'disable_realtime', enabled: false, payload_json: null },
          ],
          error: null,
        }),
      });

      const snap = await service.getPublicFlagsSnapshot();
      expect(snap).toEqual({
        maintenanceBanner: {
          enabled: true,
          message: 'Maintenance Saturday',
          severity: 'critical',
        },
        realtimeDisabled: false,
        timeSimulation: { enabled: false, simulatedNowIso: null, anchorRealIso: null },
      });
    });

    it('only surfaces banner + realtime flags, never internal kill switches', async () => {
      // Simulate the caller asking for the snapshot while `admin_lockdown`
      // and `read_only_mode` are enabled — the response must not leak them.
      const inSpy = vi.fn().mockResolvedValue({
        data: [
          { key: 'maintenance_banner', enabled: false, payload_json: null },
          { key: 'disable_realtime', enabled: true, payload_json: null },
        ],
        error: null,
      });
      fromMock.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        in: inSpy,
      });

      const snap = await service.getPublicFlagsSnapshot();

      expect(inSpy).toHaveBeenCalledWith('key', [
        'maintenance_banner',
        'disable_realtime',
        'time_simulation',
      ]);
      expect(snap).toEqual({
        maintenanceBanner: { enabled: false, message: null, severity: null },
        realtimeDisabled: true,
        timeSimulation: { enabled: false, simulatedNowIso: null, anchorRealIso: null },
      });
      expect(snap).not.toHaveProperty('adminLockdown');
      expect(snap).not.toHaveProperty('readOnlyMode');
    });

    it('includes the time simulation payload when the flag is on', async () => {
      fromMock.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        in: vi.fn().mockResolvedValue({
          data: [
            {
              key: 'time_simulation',
              enabled: true,
              payload_json: {
                simulatedNowIso: '2027-05-22T08:00:00.000Z',
                anchorRealIso: '2026-07-13T12:00:00.000Z',
              },
            },
          ],
          error: null,
        }),
      });

      const snap = await service.getPublicFlagsSnapshot();
      expect(snap.timeSimulation).toEqual({
        enabled: true,
        simulatedNowIso: '2027-05-22T08:00:00.000Z',
        anchorRealIso: '2026-07-13T12:00:00.000Z',
      });
    });

    it('returns the safe default if the supabase query errors', async () => {
      fromMock.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        in: vi.fn().mockResolvedValue({ data: null, error: { message: 'boom' } }),
      });

      const snap = await service.getPublicFlagsSnapshot();
      expect(snap).toEqual({
        maintenanceBanner: { enabled: false, message: null, severity: null },
        realtimeDisabled: false,
        timeSimulation: { enabled: false, simulatedNowIso: null, anchorRealIso: null },
      });
    });
  });

  it('isEnabled returns the stored value', async () => {
    fromMock.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { enabled: true }, error: null }),
    });

    expect(await service.isEnabled('admin_lockdown')).toBe(true);
  });

  it('isEnabled falls back to the registry default when no row exists', async () => {
    fromMock.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    });

    expect(await service.isEnabled('admin_lockdown')).toBe(false);
  });

  it('isEnabled caches the value for 5 seconds', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-19T17:00:00Z'));

    const maybeSingle = vi
      .fn()
      .mockResolvedValueOnce({ data: { enabled: true }, error: null })
      .mockResolvedValueOnce({ data: { enabled: false }, error: null });

    fromMock.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle,
    });

    expect(await service.isEnabled('admin_lockdown')).toBe(true);
    expect(maybeSingle).toHaveBeenCalledTimes(1);

    // Still inside cache TTL → no new query
    vi.setSystemTime(new Date('2026-05-19T17:00:04Z'));
    expect(await service.isEnabled('admin_lockdown')).toBe(true);
    expect(maybeSingle).toHaveBeenCalledTimes(1);

    // Past TTL → re-query, get the new value
    vi.setSystemTime(new Date('2026-05-19T17:00:06Z'));
    expect(await service.isEnabled('admin_lockdown')).toBe(false);
    expect(maybeSingle).toHaveBeenCalledTimes(2);
  });

  it('upsert invalidates the cache so the next read is fresh', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-19T17:00:00Z'));

    const maybeSingle = vi
      .fn()
      .mockResolvedValueOnce({ data: { enabled: false }, error: null })
      .mockResolvedValueOnce({ data: { enabled: true }, error: null });

    fromMock.mockImplementation((table: string) => {
      if (table === 'feature_flags') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle,
          upsert: vi.fn().mockResolvedValue({ data: null, error: null }),
        };
      }
      return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) };
    });

    expect(await service.isEnabled('admin_lockdown')).toBe(false);
    await service.upsertFlag('admin_lockdown', { enabled: true }, 'actor');
    // Cache invalidated → next read hits the DB again
    expect(await service.isEnabled('admin_lockdown')).toBe(true);
    expect(maybeSingle).toHaveBeenCalledTimes(2);
  });
});
