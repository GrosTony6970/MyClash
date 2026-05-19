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

    // Registry currently has one entry: admin_lockdown
    expect(flags).toHaveLength(1);
    expect(flags[0]?.key).toBe('admin_lockdown');
    expect(flags[0]?.enabled).toBe(false); // registry default
    expect(flags[0]?.updated_at).toBeNull();
  });

  it('overlays stored row state onto the registry entries', async () => {
    fromMock.mockReturnValue({
      select: vi.fn().mockResolvedValue({
        data: [
          {
            key: 'admin_lockdown',
            description: 'in maintenance',
            enabled: true,
            updated_at: '2026-05-19T15:00:00Z',
            updated_by_user_id: 'actor-1',
          },
        ],
        error: null,
      }),
    });

    const flags = await service.listFlagsWithRegistry();

    expect(flags[0]).toEqual({
      key: 'admin_lockdown',
      enabled: true,
      description: 'in maintenance',
      updated_at: '2026-05-19T15:00:00Z',
    });
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
