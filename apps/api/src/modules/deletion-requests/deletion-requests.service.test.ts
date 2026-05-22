/**
 * deletion-requests.service.test.ts — Event Lifecycle Protection
 *
 * Tests for DeletionRequestsService:
 *   ✓ create accepts an archived event target
 *   ✓ create refuses a non-archived event
 *   ✓ create accepts a tournament with scored matches
 *   ✓ create rejects with ConflictException on unique-violation (code 23505)
 *   ✓ cancel transitions pending → cancelled when actor is org admin
 *   ✓ cancel throws BadRequestException when request is already approved
 *   ✓ listForOrganization delegates auth to assertOrgRole(read_only)
 *   ✓ getActivePendingForTarget returns null when no pending request exists
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { DeletionRequestsService } from './deletion-requests.service';

// ── Mock helpers ──────────────────────────────────────────────────────────────

const fromMock = vi.fn();
const mockSupabase = { service: { from: fromMock } };
const mockOrganizations = { assertOrgRole: vi.fn().mockResolvedValue(undefined) };

function makeChain(result: unknown) {
  const chain = {
    select: vi.fn() as ReturnType<typeof vi.fn>,
    eq: vi.fn() as ReturnType<typeof vi.fn>,
    neq: vi.fn() as ReturnType<typeof vi.fn>,
    or: vi.fn() as ReturnType<typeof vi.fn>,
    is: vi.fn() as ReturnType<typeof vi.fn>,
    limit: vi.fn() as ReturnType<typeof vi.fn>,
    order: vi.fn() as ReturnType<typeof vi.fn>,
    insert: vi.fn() as ReturnType<typeof vi.fn>,
    update: vi.fn() as ReturnType<typeof vi.fn>,
    upsert: vi.fn() as ReturnType<typeof vi.fn>,
    delete: vi.fn() as ReturnType<typeof vi.fn>,
    in: vi.fn() as ReturnType<typeof vi.fn>,
    not: vi.fn() as ReturnType<typeof vi.fn>,
    maybeSingle: vi.fn().mockResolvedValue(result),
    single: vi.fn().mockResolvedValue(result),
  };
  for (const key of [
    'select',
    'eq',
    'neq',
    'or',
    'is',
    'limit',
    'order',
    'insert',
    'update',
    'upsert',
    'delete',
    'in',
    'not',
  ]) {
    chain[key as keyof typeof chain] = vi.fn().mockReturnValue(chain);
  }
  return chain;
}

function makeResolvedChain(result: unknown) {
  const chain = makeChain(result);
  const awaitable = Object.assign(Promise.resolve(result), chain);
  for (const key of [
    'select',
    'eq',
    'neq',
    'or',
    'is',
    'order',
    'insert',
    'update',
    'upsert',
    'delete',
    'in',
    'not',
  ]) {
    (awaitable as unknown as Record<string, unknown>)[key] = vi.fn().mockReturnValue(awaitable);
  }
  return awaitable;
}

function makeCountChain(count: number) {
  const chain = makeChain({ count, error: null });
  const awaitable = Object.assign(Promise.resolve({ count, error: null }), chain);
  for (const key of ['select', 'eq', 'neq']) {
    (awaitable as unknown as Record<string, unknown>)[key] = vi.fn().mockReturnValue(awaitable);
  }
  return awaitable;
}

const BASE_REQUEST_ROW = {
  id: 'req-uuid-1',
  target_type: 'event',
  target_id: 'event-uuid-1',
  organization_id: 'org-uuid-1',
  requester_user_id: 'user-uuid-1',
  reason: 'Event is fully archived and no longer needed.',
  status: 'pending',
  reviewed_by_user_id: null,
  reviewed_at: null,
  rejection_reason: null,
  approved_executed_at: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('DeletionRequestsService — create', () => {
  let service: DeletionRequestsService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockOrganizations.assertOrgRole.mockResolvedValue(undefined);
    service = new DeletionRequestsService(mockSupabase as never, mockOrganizations as never);
  });

  it('accepts an archived event target and returns a pending row', async () => {
    const eventRow = { id: 'event-uuid-1', organization_id: 'org-uuid-1', status: 'archived' };

    const eventChain = makeChain({ data: eventRow, error: null });
    eventChain.maybeSingle.mockResolvedValue({ data: eventRow, error: null });

    const insertChain = makeChain({ data: BASE_REQUEST_ROW, error: null });
    insertChain.single.mockResolvedValue({ data: BASE_REQUEST_ROW, error: null });

    fromMock
      .mockReturnValueOnce(eventChain) // events lookup
      .mockReturnValueOnce(insertChain); // insert

    const result = await service.create(
      {
        targetType: 'event',
        targetId: 'event-uuid-1',
        reason: 'Event is fully archived and no longer needed.',
      },
      'user-uuid-1',
    );

    expect(result.status).toBe('pending');
    expect(result.targetType).toBe('event');
    expect(mockOrganizations.assertOrgRole).toHaveBeenCalledWith(
      'org-uuid-1',
      'user-uuid-1',
      'admin',
    );
  });

  it('refuses a non-archived event (throws BadRequestException)', async () => {
    const eventRow = { id: 'event-uuid-1', organization_id: 'org-uuid-1', status: 'published' };

    const eventChain = makeChain({ data: eventRow, error: null });
    eventChain.maybeSingle.mockResolvedValue({ data: eventRow, error: null });

    fromMock.mockReturnValueOnce(eventChain);

    await expect(
      service.create(
        { targetType: 'event', targetId: 'event-uuid-1', reason: 'Trying to delete active event.' },
        'user-uuid-1',
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('accepts a tournament with scored matches when status is not eligible', async () => {
    const tournRow = { id: 'tourn-uuid-1', event_id: 'event-uuid-1', status: 'draft' };
    const evRow = { organization_id: 'org-uuid-1' };
    const requestRow = {
      ...BASE_REQUEST_ROW,
      target_type: 'tournament',
      target_id: 'tourn-uuid-1',
    };

    const tournChain = makeChain({ data: tournRow, error: null });
    tournChain.maybeSingle.mockResolvedValue({ data: tournRow, error: null });

    // Scored matches count = 2
    const matchCountChain = makeCountChain(2);

    const evChain = makeChain({ data: evRow, error: null });
    evChain.maybeSingle.mockResolvedValue({ data: evRow, error: null });

    const insertChain = makeChain({ data: requestRow, error: null });
    insertChain.single.mockResolvedValue({ data: requestRow, error: null });

    fromMock
      .mockReturnValueOnce(tournChain) // tournaments lookup
      .mockReturnValueOnce(matchCountChain) // matches count (scored)
      .mockReturnValueOnce(evChain) // events lookup for org_id
      .mockReturnValueOnce(insertChain); // insert

    const result = await service.create(
      {
        targetType: 'tournament',
        targetId: 'tourn-uuid-1',
        reason: 'Tournament has scored matches and needs cleanup.',
      },
      'user-uuid-1',
    );

    expect(result.status).toBe('pending');
    expect(result.targetType).toBe('tournament');
  });

  it('rejects with ConflictException on unique-violation (code 23505)', async () => {
    const eventRow = { id: 'event-uuid-1', organization_id: 'org-uuid-1', status: 'archived' };

    const eventChain = makeChain({ data: eventRow, error: null });
    eventChain.maybeSingle.mockResolvedValue({ data: eventRow, error: null });

    const uniqueViolationError = {
      message: 'duplicate key value violates unique constraint',
      code: '23505',
    };
    const insertChain = makeChain({ data: null, error: uniqueViolationError });
    insertChain.single.mockResolvedValue({ data: null, error: uniqueViolationError });

    fromMock.mockReturnValueOnce(eventChain).mockReturnValueOnce(insertChain);

    await expect(
      service.create(
        {
          targetType: 'event',
          targetId: 'event-uuid-1',
          reason: 'Duplicate request attempt for this event.',
        },
        'user-uuid-1',
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('throws NotFoundException when target event does not exist', async () => {
    const eventChain = makeChain({ data: null, error: null });
    eventChain.maybeSingle.mockResolvedValue({ data: null, error: null });

    fromMock.mockReturnValueOnce(eventChain);

    await expect(
      service.create(
        {
          targetType: 'event',
          targetId: 'nonexistent-uuid',
          reason: 'Requesting deletion of missing event.',
        },
        'user-uuid-1',
      ),
    ).rejects.toThrow(NotFoundException);
  });
});

// ── cancel ────────────────────────────────────────────────────────────────────

describe('DeletionRequestsService — cancel', () => {
  let service: DeletionRequestsService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockOrganizations.assertOrgRole.mockResolvedValue(undefined);
    service = new DeletionRequestsService(mockSupabase as never, mockOrganizations as never);
  });

  it('transitions pending → cancelled when actor is org admin', async () => {
    const fetchChain = makeChain({ data: BASE_REQUEST_ROW, error: null });
    fetchChain.maybeSingle.mockResolvedValue({ data: BASE_REQUEST_ROW, error: null });

    const updateChain = makeResolvedChain({ data: null, error: null });

    fromMock
      .mockReturnValueOnce(fetchChain) // fetch request
      .mockReturnValueOnce(updateChain); // update

    await expect(service.cancel('req-uuid-1', 'user-uuid-1')).resolves.toBeUndefined();

    expect(mockOrganizations.assertOrgRole).toHaveBeenCalledWith(
      'org-uuid-1',
      'user-uuid-1',
      'admin',
    );

    const updateCall = (updateChain as unknown as { update: ReturnType<typeof vi.fn> }).update;
    expect(updateCall).toHaveBeenCalledWith(expect.objectContaining({ status: 'cancelled' }));
  });

  it('throws BadRequestException when request is already approved', async () => {
    const approvedRow = { ...BASE_REQUEST_ROW, status: 'approved' };

    const fetchChain = makeChain({ data: approvedRow, error: null });
    fetchChain.maybeSingle.mockResolvedValue({ data: approvedRow, error: null });

    fromMock.mockReturnValueOnce(fetchChain);

    await expect(service.cancel('req-uuid-1', 'user-uuid-1')).rejects.toThrow(BadRequestException);
  });

  it('throws NotFoundException when request does not exist', async () => {
    const fetchChain = makeChain({ data: null, error: null });
    fetchChain.maybeSingle.mockResolvedValue({ data: null, error: null });

    fromMock.mockReturnValueOnce(fetchChain);

    await expect(service.cancel('nonexistent-uuid', 'user-uuid-1')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('propagates ForbiddenException when actor lacks admin role', async () => {
    const fetchChain = makeChain({ data: BASE_REQUEST_ROW, error: null });
    fetchChain.maybeSingle.mockResolvedValue({ data: BASE_REQUEST_ROW, error: null });

    fromMock.mockReturnValueOnce(fetchChain);

    mockOrganizations.assertOrgRole.mockRejectedValueOnce(
      new ForbiddenException('Requires admin role or higher'),
    );

    await expect(service.cancel('req-uuid-1', 'low-priv-user')).rejects.toThrow(ForbiddenException);
  });
});

// ── listForOrganization ───────────────────────────────────────────────────────

describe('DeletionRequestsService — listForOrganization', () => {
  let service: DeletionRequestsService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockOrganizations.assertOrgRole.mockResolvedValue(undefined);
    service = new DeletionRequestsService(mockSupabase as never, mockOrganizations as never);
  });

  it('calls assertOrgRole with read_only and returns mapped rows', async () => {
    const listChain = makeResolvedChain({ data: [BASE_REQUEST_ROW], error: null });

    fromMock.mockReturnValueOnce(listChain);

    const result = await service.listForOrganization('org-uuid-1', null, 'user-uuid-1');

    expect(mockOrganizations.assertOrgRole).toHaveBeenCalledWith(
      'org-uuid-1',
      'user-uuid-1',
      'read_only',
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('req-uuid-1');
  });
});

// ── getActivePendingForTarget ─────────────────────────────────────────────────

describe('DeletionRequestsService — getActivePendingForTarget', () => {
  let service: DeletionRequestsService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockOrganizations.assertOrgRole.mockResolvedValue(undefined);
    service = new DeletionRequestsService(mockSupabase as never, mockOrganizations as never);
  });

  it('returns null when no pending request exists for the target', async () => {
    const evChain = makeChain({ data: { organization_id: 'org-uuid-1' }, error: null });
    evChain.maybeSingle.mockResolvedValue({ data: { organization_id: 'org-uuid-1' }, error: null });

    const pendingChain = makeChain({ data: null, error: null });
    pendingChain.maybeSingle.mockResolvedValue({ data: null, error: null });

    fromMock.mockReturnValueOnce(evChain).mockReturnValueOnce(pendingChain);

    const result = await service.getActivePendingForTarget('event', 'event-uuid-1', 'user-uuid-1');

    expect(result).toBeNull();
    expect(mockOrganizations.assertOrgRole).toHaveBeenCalledWith(
      'org-uuid-1',
      'user-uuid-1',
      'read_only',
    );
  });

  it('returns the pending row when one exists', async () => {
    const evChain = makeChain({ data: { organization_id: 'org-uuid-1' }, error: null });
    evChain.maybeSingle.mockResolvedValue({ data: { organization_id: 'org-uuid-1' }, error: null });

    const pendingChain = makeChain({ data: BASE_REQUEST_ROW, error: null });
    pendingChain.maybeSingle.mockResolvedValue({ data: BASE_REQUEST_ROW, error: null });

    fromMock.mockReturnValueOnce(evChain).mockReturnValueOnce(pendingChain);

    const result = await service.getActivePendingForTarget('event', 'event-uuid-1', 'user-uuid-1');

    expect(result).not.toBeNull();
    expect(result!.status).toBe('pending');
  });
});
