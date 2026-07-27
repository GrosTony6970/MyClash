import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { OrganizationFollowsService, MAX_FOLLOWER_FANOUT } from './organization-follows.service';

const fromMock = vi.fn();
const mockSupabase = { service: { from: fromMock }, anon: {} };

/** Chain that is awaitable AND terminable, so any query shape resolves. */
function makeChain(result: unknown) {
  const chain = Object.assign(Promise.resolve(result), {}) as Record<
    string,
    ReturnType<typeof vi.fn>
  > &
    Promise<unknown>;
  for (const key of ['select', 'eq', 'order', 'limit', 'insert', 'upsert', 'delete']) {
    chain[key] = vi.fn().mockReturnValue(chain);
  }
  chain['maybeSingle'] = vi.fn().mockResolvedValue(result);
  chain['single'] = vi.fn().mockResolvedValue(result);
  return chain;
}

const ACTIVE_ORG = { data: { id: 'org-1', status: 'active' }, error: null };

describe('OrganizationFollowsService', () => {
  let service: OrganizationFollowsService;

  beforeEach(() => {
    vi.clearAllMocks();
    fromMock.mockReturnValue(makeChain({ data: null, error: null }));
    service = new OrganizationFollowsService(mockSupabase as never);
  });

  describe('follow', () => {
    it('upserts with ignoreDuplicates so a double tap is not a 409', async () => {
      const orgChain = makeChain(ACTIVE_ORG);
      orgChain['maybeSingle']!.mockResolvedValue(ACTIVE_ORG);
      const upsertChain = makeChain({ data: null, error: null });
      fromMock.mockReturnValueOnce(orgChain).mockReturnValueOnce(upsertChain);

      await expect(service.follow('user-1', 'org-1')).resolves.toEqual({ following: true });

      expect(upsertChain['upsert']!).toHaveBeenCalledWith(
        { follower_user_id: 'user-1', followed_organization_id: 'org-1' },
        { onConflict: 'follower_user_id,followed_organization_id', ignoreDuplicates: true },
      );
    });

    it('refuses to follow an organisation that is not active', async () => {
      // Same rule as the public page: you can only follow what is publicly
      // visible in the first place.
      const orgChain = makeChain({ data: { id: 'org-1', status: 'suspended' }, error: null });
      orgChain['maybeSingle']!.mockResolvedValue({
        data: { id: 'org-1', status: 'suspended' },
        error: null,
      });
      fromMock.mockReturnValueOnce(orgChain);

      await expect(service.follow('user-1', 'org-1')).rejects.toThrow(NotFoundException);
    });

    it('refuses to follow an organisation that does not exist', async () => {
      const orgChain = makeChain({ data: null, error: null });
      orgChain['maybeSingle']!.mockResolvedValue({ data: null, error: null });
      fromMock.mockReturnValueOnce(orgChain);

      await expect(service.follow('user-1', 'missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('unfollow', () => {
    it('is a no-op when the follow does not exist', async () => {
      const chain = makeChain({ data: null, error: null });
      fromMock.mockReturnValueOnce(chain);

      await expect(service.unfollow('user-1', 'org-1')).resolves.toEqual({ following: false });
      expect(chain['delete']!).toHaveBeenCalled();
      expect(chain['eq']!).toHaveBeenCalledWith('follower_user_id', 'user-1');
      expect(chain['eq']!).toHaveBeenCalledWith('followed_organization_id', 'org-1');
    });
  });

  describe('list', () => {
    it('projects the joined organisation onto each row', async () => {
      const chain = makeChain({
        data: [
          {
            followed_organization_id: 'org-1',
            notify_new_event: true,
            created_at: '2026-07-01T00:00:00Z',
            organizations: {
              slug: 'lyon-amhe',
              name: 'Lyon AMHE',
              logo_url: null,
              brand_color: '#b91c1c',
            },
          },
        ],
        error: null,
      });
      fromMock.mockReturnValueOnce(chain);

      await expect(service.list('user-1')).resolves.toEqual([
        {
          organizationId: 'org-1',
          slug: 'lyon-amhe',
          name: 'Lyon AMHE',
          logoUrl: null,
          brandColor: '#b91c1c',
          notifyNewEvent: true,
          followedAt: '2026-07-01T00:00:00Z',
        },
      ]);
    });

    it('skips a follow whose organisation was deleted underneath it', async () => {
      // Rendering a nameless card is worse than rendering nothing.
      const chain = makeChain({
        data: [
          {
            followed_organization_id: 'gone',
            notify_new_event: true,
            created_at: '2026-07-01T00:00:00Z',
            organizations: null,
          },
        ],
        error: null,
      });
      fromMock.mockReturnValueOnce(chain);

      await expect(service.list('user-1')).resolves.toEqual([]);
    });
  });

  describe('followerUserIds', () => {
    it('asks only for followers who have not muted the organiser', async () => {
      const chain = makeChain({ data: [{ follower_user_id: 'u1' }], error: null });
      fromMock.mockReturnValueOnce(chain);

      await expect(service.followerUserIds('org-1')).resolves.toEqual(['u1']);
      expect(chain['eq']!).toHaveBeenCalledWith('notify_new_event', true);
    });

    it('truncates at the fan-out cap so one organisation cannot wedge a publish', async () => {
      const rows = Array.from({ length: MAX_FOLLOWER_FANOUT + 1 }, (_, i) => ({
        follower_user_id: `u${i}`,
      }));
      const chain = makeChain({ data: rows, error: null });
      fromMock.mockReturnValueOnce(chain);

      const ids = await service.followerUserIds('org-1');

      expect(ids).toHaveLength(MAX_FOLLOWER_FANOUT);
      // Over-fetch by one is how the truncation is detected at all.
      expect(chain['limit']!).toHaveBeenCalledWith(MAX_FOLLOWER_FANOUT + 1);
    });

    it('returns every follower when under the cap', async () => {
      const chain = makeChain({
        data: [{ follower_user_id: 'u1' }, { follower_user_id: 'u2' }],
        error: null,
      });
      fromMock.mockReturnValueOnce(chain);

      await expect(service.followerUserIds('org-1')).resolves.toEqual(['u1', 'u2']);
    });
  });

  describe('countFollowers', () => {
    it('returns 0 rather than null when the org has no followers', async () => {
      // The chain is already awaitable and resolves to {count, error}; do NOT
      // override .select, which would break the .eq() that follows it.
      const chain = makeChain({ count: null, error: null });
      fromMock.mockReturnValueOnce(chain);

      await expect(service.countFollowers('org-1')).resolves.toBe(0);
    });
  });
});
