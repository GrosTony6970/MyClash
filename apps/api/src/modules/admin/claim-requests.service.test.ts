import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { ClaimRequestsService } from './claim-requests.service';

// ── Mocks ──────────────────────────────────────────────────────────────────

const fromMock = vi.fn();
const getUserByIdMock = vi.fn();
const sendNotificationMock = vi.fn().mockResolvedValue(undefined);

const mockSupabase = {
  service: {
    from: fromMock,
    auth: { admin: { getUserById: getUserByIdMock } },
  },
};

const mockMail = {
  sendNotification: sendNotificationMock,
};

/** Chainable query-builder stub: every builder method returns `this`,
 *  `maybeSingle()` resolves to the supplied result, and awaiting the chain
 *  directly (e.g. `update().eq().is()`) yields the result's own fields. */
function makeQueryChain(result: unknown) {
  const resolved = result && typeof result === 'object' ? (result as Record<string, unknown>) : {};
  return {
    ...resolved,
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
  };
}

describe('ClaimRequestsService.approve', () => {
  let service: ClaimRequestsService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ClaimRequestsService(mockSupabase as never, mockMail as never);
  });

  it('flips linked persons to claimed and notifies the requester', async () => {
    getUserByIdMock.mockResolvedValue({
      data: { user: { email: 'req@example.com' } },
      error: null,
    });

    const loadPendingChain = makeQueryChain({
      data: { user_id: 'user-1', global_person_id: 'global-1', status: 'pending' },
      error: null,
    });
    // email already present → backfill branch is skipped.
    const globalUpdateChain = makeQueryChain({
      data: { id: 'global-1', email: 'existing@example.com' },
      error: null,
    });
    const personsSyncChain = makeQueryChain({ data: null, error: null });
    const markDecidedChain = makeQueryChain({ data: null, error: null });
    fromMock
      .mockReturnValueOnce(loadPendingChain)
      .mockReturnValueOnce(globalUpdateChain)
      .mockReturnValueOnce(personsSyncChain)
      .mockReturnValueOnce(markDecidedChain);

    await service.approve('req-1', 'admin-1');

    expect(globalUpdateChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ claimed_by_user_id: 'user-1' }),
    );
    expect(personsSyncChain.update).toHaveBeenCalledWith({
      claim_status: 'claimed',
      claimed_by_user_id: 'user-1',
    });
    expect(personsSyncChain.eq).toHaveBeenCalledWith('global_person_id', 'global-1');
    expect(personsSyncChain.is).toHaveBeenCalledWith('claimed_by_user_id', null);
    expect(sendNotificationMock).toHaveBeenCalledTimes(1);
  });

  it('does not sync persons when the profile was already claimed', async () => {
    const loadPendingChain = makeQueryChain({
      data: { user_id: 'user-1', global_person_id: 'global-1', status: 'pending' },
      error: null,
    });
    // Race-guard update returns no row → already claimed by someone else.
    const globalUpdateChain = makeQueryChain({ data: null, error: null });
    const markDecidedChain = makeQueryChain({ data: null, error: null });
    fromMock
      .mockReturnValueOnce(loadPendingChain)
      .mockReturnValueOnce(globalUpdateChain)
      .mockReturnValueOnce(markDecidedChain);

    await expect(service.approve('req-1', 'admin-1')).rejects.toBeInstanceOf(BadRequestException);

    // Only loadPending, the race-guard update, and markDecided('rejected') ran —
    // never a persons sync.
    expect(fromMock).toHaveBeenCalledTimes(3);
    expect(sendNotificationMock).not.toHaveBeenCalled();
  });
});
