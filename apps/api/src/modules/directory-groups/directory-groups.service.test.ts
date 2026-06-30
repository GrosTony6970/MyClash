/**
 * directory-groups.service.test.ts
 *
 * Covers the bits with real logic:
 *   ✓ compact stats win-rate derivation (rounding + div-by-zero → null)
 *   ✓ duplicate group name → ConflictException (23505 mapping)
 *   ✓ adding a soft-deleted/merged fighter is rejected
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { MemberStatsService } from './member-stats.service';
import { DirectoryGroupsService } from './directory-groups.service';

function makeChain(result: unknown) {
  const chain: Record<string, unknown> = {
    maybeSingle: vi.fn().mockResolvedValue(result),
    single: vi.fn().mockResolvedValue(result),
  };
  for (const key of ['select', 'eq', 'in', 'order', 'insert', 'update', 'delete', 'upsert']) {
    chain[key] = vi.fn().mockReturnValue(chain);
  }
  return chain;
}

describe('MemberStatsService.getCompactStats', () => {
  const rpc = vi.fn();
  const from = vi.fn();
  const supabase = { service: { rpc, from } };
  let service: MemberStatsService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new MemberStatsService(supabase as never);
  });

  it('derives integer win-rate and keeps wins/losses/events', async () => {
    rpc.mockResolvedValue({
      data: [{ global_person_id: 'a', matches: 4, wins: 3, losses: 1, events_attended: 2 }],
      error: null,
    });
    const map = await service.getCompactStats(['a']);
    expect(map.get('a')).toEqual({
      matches: 4,
      wins: 3,
      losses: 1,
      winRate: 75,
      eventsAttended: 2,
    });
  });

  it('returns winRate null for a fighter with no matches (no div-by-zero)', async () => {
    rpc.mockResolvedValue({
      data: [{ global_person_id: 'b', matches: 0, wins: 0, losses: 0, events_attended: 0 }],
      error: null,
    });
    const map = await service.getCompactStats(['b']);
    expect(map.get('b')?.winRate).toBeNull();
  });

  it('skips the RPC entirely for an empty id list', async () => {
    const map = await service.getCompactStats([]);
    expect(map.size).toBe(0);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('DirectoryGroupsService', () => {
  const from = vi.fn();
  const rpc = vi.fn();
  const supabase = { service: { from, rpc } };
  const memberStats = {
    getCompactStats: vi.fn().mockResolvedValue(new Map()),
    getFavoriteWeapons: vi.fn().mockResolvedValue(new Map()),
  };
  const follows = { countFollowStateForGlobalPersons: vi.fn().mockResolvedValue(new Map()) };
  let service: DirectoryGroupsService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new DirectoryGroupsService(supabase as never, memberStats as never, follows as never);
  });

  it('maps a duplicate-name unique violation to ConflictException', async () => {
    from.mockReturnValue(
      makeChain({ data: null, error: { code: '23505', message: 'duplicate key' } }),
    );
    await expect(service.createGroup('user-1', 'Rivals')).rejects.toThrow(ConflictException);
  });

  it('rejects adding a soft-deleted fighter', async () => {
    // assertOwner → group exists
    const ownerChain = makeChain({ data: { id: 'group-1' }, error: null });
    // resolveGlobalPersonId → fighter is soft-deleted
    const personChain = makeChain({
      data: { id: 'gp-1', deleted_at: '2026-01-01T00:00:00Z', merged_into_id: null },
      error: null,
    });
    from.mockReturnValueOnce(ownerChain).mockReturnValueOnce(personChain);

    await expect(
      service.addMember('user-1', 'group-1', { globalPersonId: 'gp-1' }),
    ).rejects.toThrow(NotFoundException);
  });
});
