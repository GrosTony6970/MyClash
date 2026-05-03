import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminFeatureFlagsService } from './admin-feature-flags.service';

const fromMock = vi.fn();

const mockSupabase = {
  service: { from: fromMock },
};

describe('AdminFeatureFlagsService', () => {
  let service: AdminFeatureFlagsService;

  beforeEach(() => {
    vi.clearAllMocks();
    fromMock.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: [], error: null }),
      upsert: vi.fn().mockResolvedValue({ data: null, error: null }),
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ data: null, error: null }),
      insert: vi.fn().mockResolvedValue({ data: null, error: null }),
    });
    service = new AdminFeatureFlagsService(mockSupabase as never);
  });

  it('upserts feature flags with payload and actor', async () => {
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
      'beta-dashboard',
      { description: 'Beta dashboard', enabled: true, payload: { cohort: 'internal' } },
      'actor-user',
    );

    expect(flagsChain.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'beta-dashboard',
        description: 'Beta dashboard',
        enabled: true,
        payload_json: { cohort: 'internal' },
        updated_by_user_id: 'actor-user',
      }),
    );
  });

  it('deletes feature flags by key', async () => {
    const deleteChain = {
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    const auditChain = { insert: vi.fn().mockResolvedValue({ data: null, error: null }) };
    fromMock.mockImplementation((table: string) =>
      table === 'feature_flags' ? deleteChain : auditChain,
    );

    await service.deleteFlag('old-flag', 'actor-user');

    expect(deleteChain.eq).toHaveBeenCalledWith('key', 'old-flag');
  });
});
