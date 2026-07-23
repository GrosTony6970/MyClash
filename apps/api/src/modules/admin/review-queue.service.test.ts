/**
 * review-queue.service.test.ts
 *
 * Tests:
 *   1. listAll returns aggregated items from all 3 sources sorted by createdAt desc,
 *      default to pending.
 *   2. listAll with typeFilter='deletion' only queries deletion_requests.
 *   3. approve(deletion) requires typedConfirmation='DELETE' — throws BadRequestException.
 *   4. approve(deletion) with confirmation deletes the target event and flips the request.
 *   5. reject persists rejection_reason and writes audit log.
 */

import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ReviewQueueService } from './review-queue.service';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'req-1',
    status: 'pending',
    requester_user_id: 'user-1',
    organization_id: 'org-1',
    reason: 'test reason',
    rejection_reason: null,
    reviewed_by_user_id: null,
    reviewed_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeDeletionRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return makeRow({
    target_type: 'event',
    target_id: 'event-1',
    approved_executed_at: null,
    ...overrides,
  });
}

function makeExchangeRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return makeRow({
    requested_by_user_id: 'user-1',
    match_id: 'match-1',
    exchange_id: 'exch-1',
    request_type: 'void_exchange',
    requested_payload: {},
    event_id: 'event-1',
    ...overrides,
  });
}

function makeClubReviewRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return makeRow({
    event_id: 'event-1',
    proposed_club_id: 'club-1',
    review_notes: null,
    linked_existing_club_id: null,
    ...overrides,
  });
}

// ── Supabase mock factory ─────────────────────────────────────────────────────

function makeSupabaseMock(tableData: Record<string, unknown[]>) {
  const fromMock = vi.fn((table: string) => {
    const rows = tableData[table] ?? [];
    const resolved = { data: rows, error: null };

    // A "thenable" chain — await-able at any point, and every method returns itself.
    const chain: Record<string, unknown> = {};
    const chainFn = vi.fn().mockReturnValue(chain);

    Object.assign(chain, {
      select: chainFn,
      order: chainFn,
      // eq resolves (used as terminal when awaited after order chain)
      eq: vi.fn().mockReturnValue(chain),
      neq: vi.fn().mockReturnValue(chain),
      in: vi.fn().mockResolvedValue(resolved),
      maybeSingle: vi.fn().mockResolvedValue({ data: rows[0] ?? null, error: null }),
      insert: vi.fn().mockResolvedValue({ data: null, error: null }),
      // update and delete return sub-chain whose eq resolves
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: null, error: null }),
      }),
      delete: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: null, error: null }),
      }),
      // Make the chain itself awaitable: `await q` calls `.then`
      then: (resolve: (v: typeof resolved) => void) => Promise.resolve(resolved).then(resolve),
    });

    return chain;
  });

  return { service: { from: fromMock }, _fromMock: fromMock };
}

// ── Mock services ─────────────────────────────────────────────────────────────

function makeMockExchangeEditService() {
  return {
    approve: vi.fn().mockResolvedValue({ approved: true, requestId: 'req-1', result: {} }),
    reject: vi.fn().mockResolvedValue({ rejected: true, requestId: 'req-1' }),
  };
}

function makeMockEventsService() {
  return {};
}

function makeMockLeaguesService() {
  return {
    reviewTournamentLink: vi.fn().mockResolvedValue({}),
  };
}

function makeMockMembershipRequestsService() {
  return {
    review: vi.fn().mockResolvedValue({}),
  };
}

function makeMockUserDirectory() {
  return {
    resolveUsers: vi.fn().mockResolvedValue(new Map()),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ReviewQueueService', () => {
  let service: ReviewQueueService;
  let mockExchangeEditService: ReturnType<typeof makeMockExchangeEditService>;

  // ── 1. listAll aggregates all 3 sources, defaults to pending ─────────────────

  it('listAll returns aggregated items from all 3 sources sorted by createdAt desc, default to pending', async () => {
    const tableData: Record<string, unknown[]> = {
      deletion_requests: [makeDeletionRow({ created_at: '2026-01-03T00:00:00.000Z' })],
      exchange_edit_requests: [makeExchangeRow({ created_at: '2026-01-04T00:00:00.000Z' })],
      club_review_requests: [makeClubReviewRow({ created_at: '2026-01-02T00:00:00.000Z' })],
      fighters: [],
      organizations: [],
      events: [],
      tournaments: [],
      clubs: [],
    };
    const supabase = makeSupabaseMock(tableData);
    mockExchangeEditService = makeMockExchangeEditService();
    service = new ReviewQueueService(
      supabase as never,
      makeMockEventsService() as never,
      mockExchangeEditService as never,
      makeMockLeaguesService() as never,
      makeMockMembershipRequestsService() as never,
      makeMockUserDirectory() as never,
    );

    const result = await service.listAll(null, null);

    // Should have 3 items
    expect(result).toHaveLength(3);

    // Should be sorted descending by createdAt
    expect(result[0]!.type).toBe('exchange_edit'); // 2026-01-04
    expect(result[1]!.type).toBe('deletion'); // 2026-01-03
    expect(result[2]!.type).toBe('club_review'); // 2026-01-02

    // The status filter 'pending' should have been applied (eq('status', 'pending') called)
    expect(supabase._fromMock).toHaveBeenCalledWith('deletion_requests');
    expect(supabase._fromMock).toHaveBeenCalledWith('exchange_edit_requests');
    expect(supabase._fromMock).toHaveBeenCalledWith('club_review_requests');
  });

  // ── 2. listAll with typeFilter='deletion' only queries deletion_requests ─────

  it('listAll with typeFilter=deletion only queries deletion_requests', async () => {
    const tableData: Record<string, unknown[]> = {
      deletion_requests: [makeDeletionRow()],
      fighters: [],
      organizations: [],
      events: [],
      tournaments: [],
    };
    const supabase = makeSupabaseMock(tableData);
    service = new ReviewQueueService(
      supabase as never,
      makeMockEventsService() as never,
      makeMockExchangeEditService() as never,
      makeMockLeaguesService() as never,
      makeMockMembershipRequestsService() as never,
      makeMockUserDirectory() as never,
    );

    const result = await service.listAll('deletion', null);

    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe('deletion');

    // Should NOT have queried other tables
    const calledTables = supabase._fromMock.mock.calls.map(([t]: [string]) => t);
    expect(calledTables).not.toContain('exchange_edit_requests');
    expect(calledTables).not.toContain('club_review_requests');
  });

  // ── 2b. listAll includes league_tournament_request rows under "all" ─────────

  it('listAll includes league_tournament_request rows from league_tournament_links', async () => {
    const tableData: Record<string, unknown[]> = {
      league_tournament_links: [
        {
          id: 'link-1',
          status: 'requested',
          league_id: 'league-1',
          tournament_id: 'tournament-1',
          requested_by_user_id: null,
          reviewed_by_user_id: null,
          created_at: '2026-02-01T00:00:00.000Z',
          note: 'please attach',
          leagues: { id: 'league-1', name: 'FFAMHE TF 2026', slug: 'ffamhe-2026' },
          tournaments: {
            id: 'tournament-1',
            name: 'Open Longsword',
            weapon: 'longsword',
            event_id: 'event-1',
            events: {
              id: 'event-1',
              name: 'Paris HEMA Open',
              organization_id: 'org-1',
              organizations: { id: 'org-1', name: 'Paris HEMA Club' },
            },
          },
        },
      ],
      fighters: [],
      organizations: [],
      events: [],
      tournaments: [],
    };
    const supabase = makeSupabaseMock(tableData);
    service = new ReviewQueueService(
      supabase as never,
      makeMockEventsService() as never,
      makeMockExchangeEditService() as never,
      makeMockLeaguesService() as never,
      makeMockMembershipRequestsService() as never,
      makeMockUserDirectory() as never,
    );

    const result = await service.listAll('league_tournament_request', null);

    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe('league_tournament_request');
    expect(result[0]!.status).toBe('pending');
    expect(result[0]!.targetLabel).toContain('Open Longsword');
    expect(result[0]!.targetLabel).toContain('FFAMHE TF 2026');
    expect(result[0]!.organizationName).toBe('Paris HEMA Club');
    expect(result[0]!.targetHref).toBe('/admin/leagues/league-1/edit');
  });

  // ── 2c. approve(league_tournament_request) dispatches to leagues service ─────

  it('approve(league_tournament_request) calls reviewTournamentLink with status=approved', async () => {
    const leagues = makeMockLeaguesService();
    const supabase = makeSupabaseMock({});
    service = new ReviewQueueService(
      supabase as never,
      makeMockEventsService() as never,
      makeMockExchangeEditService() as never,
      leagues as never,
      makeMockMembershipRequestsService() as never,
      makeMockUserDirectory() as never,
    );

    await service.approve('league_tournament_request', 'link-1', 'actor-1');

    expect(leagues.reviewTournamentLink).toHaveBeenCalledWith(
      'link-1',
      { status: 'approved' },
      'actor-1',
    );
  });

  // ── 2d. approve(league_membership_request) dispatches to membership service ──

  it('approve(league_membership_request) calls membership review with status=approved', async () => {
    const membership = makeMockMembershipRequestsService();
    const supabase = makeSupabaseMock({});
    service = new ReviewQueueService(
      supabase as never,
      makeMockEventsService() as never,
      makeMockExchangeEditService() as never,
      makeMockLeaguesService() as never,
      membership as never,
      makeMockUserDirectory() as never,
    );

    await service.approve('league_membership_request', 'req-1', 'actor-1');

    expect(membership.review).toHaveBeenCalledWith('req-1', { status: 'approved' }, 'actor-1');
  });

  // ── 3. approve(deletion) requires typedConfirmation='DELETE' ─────────────────

  it('approve(deletion) throws BadRequestException when typedConfirmation is missing', async () => {
    const supabase = makeSupabaseMock({});
    service = new ReviewQueueService(
      supabase as never,
      makeMockEventsService() as never,
      makeMockExchangeEditService() as never,
      makeMockLeaguesService() as never,
      makeMockMembershipRequestsService() as never,
      makeMockUserDirectory() as never,
    );

    await expect(service.approve('deletion', 'req-1', 'actor-1', {})).rejects.toThrow(
      BadRequestException,
    );

    await expect(
      service.approve('deletion', 'req-1', 'actor-1', { typedConfirmation: 'WRONG' }),
    ).rejects.toThrow(BadRequestException);
  });

  // ── 4. approve(deletion) deletes target event and flips request to approved ──

  it('approve(deletion) with correct confirmation deletes the target event and marks approved', async () => {
    const deletionRow = makeDeletionRow({
      id: 'req-1',
      target_type: 'event',
      target_id: 'event-99',
    });

    const eventsDeleteEq = vi.fn().mockResolvedValue({ data: null, error: null });
    const requestsUpdateEq = vi.fn().mockResolvedValue({ data: null, error: null });

    const fromMock = vi.fn((table: string) => {
      if (table === 'deletion_requests') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: deletionRow, error: null }),
          update: vi.fn().mockReturnValue({ eq: requestsUpdateEq }),
        };
      }
      if (table === 'events') {
        return {
          delete: vi.fn().mockReturnValue({ eq: eventsDeleteEq }),
        };
      }
      if (table === 'audit_log') {
        return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) };
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      };
    });

    const supabase = { service: { from: fromMock } };
    service = new ReviewQueueService(
      supabase as never,
      makeMockEventsService() as never,
      makeMockExchangeEditService() as never,
      makeMockLeaguesService() as never,
      makeMockMembershipRequestsService() as never,
      makeMockUserDirectory() as never,
    );

    await service.approve('deletion', 'req-1', 'actor-user', { typedConfirmation: 'DELETE' });

    // Event was deleted
    expect(eventsDeleteEq).toHaveBeenCalledWith('id', 'event-99');

    // Deletion request was flipped to approved
    expect(requestsUpdateEq).toHaveBeenCalledWith('id', 'req-1');
  });

  // ── 5. reject persists rejection_reason and writes audit log ─────────────────

  it('reject persists rejection_reason and writes audit log', async () => {
    const pendingRow = { status: 'pending' };

    const updateEq = vi.fn().mockResolvedValue({ data: null, error: null });
    let capturedUpdate: Record<string, unknown> | null = null;
    let capturedAudit: Record<string, unknown> | null = null;

    const fromMock = vi.fn((table: string) => {
      if (table === 'deletion_requests') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: pendingRow, error: null }),
          update: vi.fn((payload: Record<string, unknown>) => {
            capturedUpdate = payload;
            return { eq: updateEq };
          }),
        };
      }
      if (table === 'audit_log') {
        return {
          insert: vi.fn((payload: Record<string, unknown>) => {
            capturedAudit = payload;
            return Promise.resolve({ data: null, error: null });
          }),
        };
      }
      return {};
    });

    const supabase = { service: { from: fromMock } };
    service = new ReviewQueueService(
      supabase as never,
      makeMockEventsService() as never,
      makeMockExchangeEditService() as never,
      makeMockLeaguesService() as never,
      makeMockMembershipRequestsService() as never,
      makeMockUserDirectory() as never,
    );

    const reason = 'This request does not meet the requirements for deletion.';
    await service.reject('deletion', 'req-1', 'actor-user', reason);

    // Status was set to rejected with the reason
    expect(capturedUpdate).toMatchObject({
      status: 'rejected',
      rejection_reason: reason,
      reviewed_by_user_id: 'actor-user',
    });

    // Audit log was written
    expect(capturedAudit).toMatchObject({
      action: 'deletion.reject',
      actor_user_id: 'actor-user',
      entity_id: 'req-1',
    });
  });

  // ── countPending — drives the sidebar badge + bell pill ────────────────────

  it('countPending sums head-only counts across all five review sources', async () => {
    // The bell polls this every 60s; the implementation must use
    // Supabase's head-count form (.select('id', { count, head: true })
    // .eq('status', …)) so no row data is transferred. Mock returns a
    // distinct count per table; assert the sum.
    const countByTable: Record<string, number> = {
      deletion_requests: 3,
      exchange_edit_requests: 2,
      club_review_requests: 1,
      league_tournament_links: 4,
      league_membership_requests: 1,
    };

    const fromMock = vi.fn((table: string) => {
      const count = countByTable[table] ?? 0;
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ count, error: null, data: null }),
        }),
      };
    });

    const supabase = { service: { from: fromMock } };
    service = new ReviewQueueService(
      supabase as never,
      makeMockEventsService() as never,
      makeMockExchangeEditService() as never,
      makeMockLeaguesService() as never,
      makeMockMembershipRequestsService() as never,
      makeMockUserDirectory() as never,
    );

    const total = await service.countPending();

    expect(total).toBe(11);
    // All five sources were polled.
    const calledTables = fromMock.mock.calls.map(([t]) => t);
    expect(calledTables).toEqual(
      expect.arrayContaining([
        'deletion_requests',
        'exchange_edit_requests',
        'club_review_requests',
        'league_tournament_links',
        'league_membership_requests',
      ]),
    );
  });

  it('countPending tolerates a failing source — contributes 0, surviving counts still surface', async () => {
    // Partial fresh deploy: one table errors. Bell must still surface
    // the surviving counts rather than 500-ing the whole endpoint.
    const fromMock = vi.fn((table: string) => {
      if (table === 'club_review_requests') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              count: null,
              error: { message: 'relation missing' },
              data: null,
            }),
          }),
        };
      }
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ count: 2, error: null, data: null }),
        }),
      };
    });

    const supabase = { service: { from: fromMock } };
    service = new ReviewQueueService(
      supabase as never,
      makeMockEventsService() as never,
      makeMockExchangeEditService() as never,
      makeMockLeaguesService() as never,
      makeMockMembershipRequestsService() as never,
      makeMockUserDirectory() as never,
    );

    const total = await service.countPending();
    // Four working sources × 2 + one failing source × 0 = 8.
    expect(total).toBe(8);
  });
});
