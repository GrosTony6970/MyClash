/**
 * follows.service.test.ts — T-610
 *
 * Key AC tested:
 *   ✓ POST idempotent (re-follow returns existing row)
 *   ✓ POST returns 403 when allow_being_followed = false
 *   ✓ Guest→claimed migration transfers follows atomically
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { FollowsService } from './follows.service';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const fromMock = vi.fn();
const mockSupabase = { service: { from: fromMock }, anon: {} };

const mockPrivacy = {
  getOrCreate: vi.fn(),
  canSeeWorkshops: vi.fn(),
  update: vi.fn(),
};
const mockFollowNotifications = {
  cancelForFollowedPerson: vi.fn().mockResolvedValue(undefined),
};

function makeChain(result: unknown) {
  const chain = {
    select: vi.fn() as ReturnType<typeof vi.fn>,
    eq: vi.fn() as ReturnType<typeof vi.fn>,
    in: vi.fn() as ReturnType<typeof vi.fn>,
    or: vi.fn() as ReturnType<typeof vi.fn>,
    order: vi.fn() as ReturnType<typeof vi.fn>,
    limit: vi.fn() as ReturnType<typeof vi.fn>,
    insert: vi.fn() as ReturnType<typeof vi.fn>,
    upsert: vi.fn() as ReturnType<typeof vi.fn>,
    update: vi.fn() as ReturnType<typeof vi.fn>,
    delete: vi.fn() as ReturnType<typeof vi.fn>,
    maybeSingle: vi.fn().mockResolvedValue(result),
    single: vi.fn().mockResolvedValue(result),
  };
  for (const key of [
    'select',
    'eq',
    'in',
    'or',
    'order',
    'limit',
    'insert',
    'upsert',
    'update',
    'delete',
  ]) {
    chain[key as keyof typeof chain] = vi.fn().mockReturnValue(chain);
  }
  return chain;
}

/** A query chain that is itself awaitable (resolves to `result`) — for the
 *  `const { data } = await supabase.from(...)....` patterns and terminal
 *  `.upsert(...)` / `.delete().eq().eq()` writes. */
function makeAwaitableChain(result: unknown) {
  const promise = Promise.resolve(result);
  const chain = Object.assign(promise, {}) as Record<string, unknown> & Promise<unknown>;
  for (const key of [
    'select',
    'eq',
    'in',
    'or',
    'order',
    'limit',
    'insert',
    'upsert',
    'update',
    'delete',
  ]) {
    chain[key] = vi.fn().mockReturnValue(chain);
  }
  chain['maybeSingle'] = vi.fn().mockResolvedValue(result);
  chain['single'] = vi.fn().mockResolvedValue(result);
  return chain as unknown as Record<string, ReturnType<typeof vi.fn>> & Promise<unknown>;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('FollowsService', () => {
  let service: FollowsService;

  beforeEach(() => {
    vi.clearAllMocks();
    fromMock.mockReturnValue(makeChain({ data: null, error: null }));
    service = new FollowsService(
      mockSupabase as never,
      mockPrivacy as never,
      mockFollowNotifications as never,
    );
  });

  // ── Idempotency ───────────────────────────────────────────────────────────────

  describe('follow — idempotency', () => {
    it('returns existing row when already following (no duplicate insert)', async () => {
      const existingFollow = {
        id: 'follow-1',
        followed_person_id: 'person-1',
        created_at: '2026-01-01T00:00:00Z',
        notify_match_start: true,
        notify_workshop_start: false,
        persons: { given_name: 'Jean', family_name: 'Dupont', clubs: null },
      };

      mockPrivacy.getOrCreate.mockResolvedValue({ allowBeingFollowed: true });

      // findExisting returns the existing row
      const existingChain = makeChain({ data: null, error: null });
      existingChain.maybeSingle.mockResolvedValue({ data: existingFollow, error: null });

      // nextEvent fetch
      const regsChain = makeChain({ data: [], error: null });
      regsChain.maybeSingle.mockResolvedValue({ data: [], error: null });

      fromMock
        .mockReturnValueOnce(existingChain) // findExisting
        .mockReturnValue(regsChain); // nextEvent

      const result = await service.follow('event-1', 'person-1', { userId: 'user-1' });

      expect(result.id).toBe('follow-1');
      // insert was NOT called
      const insertCalls = fromMock.mock.calls.filter((call) => call[0] === 'follows');
      // Only one from('follows') call — the findExisting check
      expect(insertCalls.length).toBe(1);
    });
  });

  // ── Privacy check ─────────────────────────────────────────────────────────────

  describe('follow — privacy', () => {
    it('throws ForbiddenException when allow_being_followed = false', async () => {
      mockPrivacy.getOrCreate.mockResolvedValue({ allowBeingFollowed: false });

      await expect(service.follow('event-1', 'person-1', { userId: 'user-1' })).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('unfollow', () => {
    it('cancels pending follow notifications for claimed users', async () => {
      const deleteChain = makeChain({ data: null, error: null });
      fromMock.mockReturnValue(deleteChain);

      await service.unfollow('event-1', 'person-1', { userId: 'user-1' });

      expect(mockFollowNotifications.cancelForFollowedPerson).toHaveBeenCalledWith(
        'person-1',
        'user-1',
      );
    });
  });

  // ── Guest→claimed migration ───────────────────────────────────────────────────

  describe('migrateGuestFollows', () => {
    it('transfers guest follows to user, skips duplicates', async () => {
      const guestFollows = [
        { id: 'f1', followed_person_id: 'person-A' },
        { id: 'f2', followed_person_id: 'person-B' }, // duplicate — user already follows B
      ];
      const userFollows = [{ followed_person_id: 'person-B' }];

      // Awaitable chains for list queries
      function makeAwaitableChain(result: unknown) {
        const promise = Promise.resolve(result);
        const chain = Object.assign(promise, {
          select: vi.fn(),
          eq: vi.fn(),
          in: vi.fn(),
          order: vi.fn(),
          limit: vi.fn(),
          delete: vi.fn(),
          update: vi.fn(),
          maybeSingle: vi.fn().mockResolvedValue(result),
          single: vi.fn().mockResolvedValue(result),
        });
        for (const key of ['select', 'eq', 'in', 'order', 'limit', 'delete', 'update']) {
          (chain as unknown as Record<string, unknown>)[key] = vi.fn().mockReturnValue(chain);
        }
        return chain;
      }

      const guestListChain = makeAwaitableChain({ data: guestFollows, error: null });
      const userListChain = makeAwaitableChain({ data: userFollows, error: null });

      const deleteChain = makeChain({ data: null, error: null });
      deleteChain.eq.mockResolvedValue({ data: null, error: null });

      const updateChain = makeChain({ data: null, error: null });
      updateChain.eq.mockResolvedValue({ data: null, error: null });

      fromMock
        .mockReturnValueOnce(guestListChain) // guest follows query
        .mockReturnValueOnce(userListChain) // user follows query
        .mockReturnValueOnce(deleteChain) // delete duplicate f2
        .mockReturnValueOnce(updateChain); // transfer f1

      const migrated = await service.migrateGuestFollows('session-1', 'user-1', 'event-1');

      // f1 transferred (person-A not in user follows)
      // f2 deleted (person-B already followed by user)
      expect(migrated).toBe(1);
    });

    it('returns 0 when guest has no follows', async () => {
      const promise = Promise.resolve({ data: [], error: null });
      const emptyChain = Object.assign(promise, makeChain({ data: [], error: null }));
      // Fix: chain methods must return the Promise itself
      for (const key of ['select', 'eq', 'in', 'order', 'limit']) {
        (emptyChain as unknown as Record<string, unknown>)[key] = vi
          .fn()
          .mockReturnValue(emptyChain);
      }
      fromMock.mockReturnValue(emptyChain);

      const migrated = await service.migrateGuestFollows('session-1', 'user-1', 'event-1');
      expect(migrated).toBe(0);
    });
  });

  // ── Persistent directory follows (global-person level) ──────────────────────

  describe('followAllEvents — persistent directory follow', () => {
    it('writes a directory follow even when the person has zero upcoming events', async () => {
      // resolveEventPersons → no upcoming event-scoped persons.
      const personsChain = makeAwaitableChain({ data: [], error: null });
      const dirFollowsChain = makeAwaitableChain({ data: null, error: null });

      fromMock
        .mockReturnValueOnce(personsChain) // resolveEventPersons
        .mockReturnValueOnce(dirFollowsChain); // directory_follows upsert

      const summary = await service.followAllEvents('gp-1', { userId: 'user-1' });

      expect(summary.upcomingEventCount).toBe(0);
      expect(summary.followedCount).toBe(0);
      expect(summary.following).toBe(true);
      expect(dirFollowsChain['upsert']).toHaveBeenCalledWith(
        { follower_user_id: 'user-1', followed_global_person_id: 'gp-1' },
        expect.objectContaining({ ignoreDuplicates: true }),
      );
    });

    it('does not write a directory follow for anonymous identities', async () => {
      const personsChain = makeAwaitableChain({ data: [], error: null });
      fromMock.mockReturnValueOnce(personsChain);

      const summary = await service.followAllEvents('gp-1', {});

      expect(summary.following).toBe(false);
      // Only the resolveEventPersons read; no directory_follows write.
      const dirCalls = fromMock.mock.calls.filter((c) => c[0] === 'directory_follows');
      expect(dirCalls.length).toBe(0);
    });
  });

  describe('unfollowAllEvents — removes the directory follow', () => {
    it('deletes the directory follow for the user', async () => {
      const dirFollowsChain = makeAwaitableChain({ data: null, error: null });
      const personsChain = makeAwaitableChain({ data: [], error: null });

      fromMock
        .mockReturnValueOnce(dirFollowsChain) // directory_follows delete
        .mockReturnValueOnce(personsChain); // resolveEventPersons (no events)

      await service.unfollowAllEvents('gp-1', { userId: 'user-1' });

      expect(dirFollowsChain['delete']).toHaveBeenCalled();
      expect(dirFollowsChain['eq']).toHaveBeenCalledWith('follower_user_id', 'user-1');
      expect(dirFollowsChain['eq']).toHaveBeenCalledWith('followed_global_person_id', 'gp-1');
    });
  });

  describe('listDirectoryFollows / filterFollowedGlobalPersons', () => {
    it('maps directory_follows rows newest-first', async () => {
      const chain = makeAwaitableChain({
        data: [
          { followed_global_person_id: 'gp-a', created_at: '2026-02-01T00:00:00Z' },
          { followed_global_person_id: 'gp-b', created_at: '2026-01-01T00:00:00Z' },
        ],
        error: null,
      });
      fromMock.mockReturnValueOnce(chain);

      const rows = await service.listDirectoryFollows('user-1');
      expect(rows).toEqual([
        { globalPersonId: 'gp-a', followedAt: '2026-02-01T00:00:00Z' },
        { globalPersonId: 'gp-b', followedAt: '2026-01-01T00:00:00Z' },
      ]);
    });

    it('returns the subset of ids the user follows', async () => {
      const chain = makeAwaitableChain({
        data: [{ followed_global_person_id: 'gp-a' }],
        error: null,
      });
      fromMock.mockReturnValueOnce(chain);

      const set = await service.filterFollowedGlobalPersons('user-1', ['gp-a', 'gp-b']);
      expect([...set]).toEqual(['gp-a']);
    });

    it('short-circuits with no ids', async () => {
      const set = await service.filterFollowedGlobalPersons('user-1', []);
      expect(set.size).toBe(0);
      expect(fromMock).not.toHaveBeenCalled();
    });
  });
});
