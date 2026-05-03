import { describe, expect, it, vi } from 'vitest';
import { ExchangeEditRequestsAdminService } from './exchange-edit-requests.service';

describe('ExchangeEditRequestsAdminService', () => {
  it('approves a pending request by applying the stored exchange edit and marking it reviewed', async () => {
    const request = {
      id: 'request-1',
      exchange_id: 'exchange-1',
      request_type: 'void_exchange' as const,
      reason: 'wrong call',
      status: 'pending',
    };
    const frozenResults = {
      loadPendingRequest: vi.fn().mockResolvedValue(request),
      markApproved: vi.fn().mockResolvedValue(undefined),
    };
    const matches = {
      approveFrozenExchangeEdit: vi.fn().mockResolvedValue({ id: 'exchange-1', voided: true }),
    };
    const service = new ExchangeEditRequestsAdminService(frozenResults as never, matches as never);

    const result = await service.approve('request-1', 'super-1');

    expect(matches.approveFrozenExchangeEdit).toHaveBeenCalledWith(request, 'super-1');
    expect(frozenResults.markApproved).toHaveBeenCalledWith(request, 'super-1');
    expect(result).toEqual({
      approved: true,
      requestId: 'request-1',
      result: { id: 'exchange-1', voided: true },
    });
  });

  it('rejects a pending request with reviewer reason', async () => {
    const request = {
      id: 'request-1',
      requested_by_user_id: 'user-1',
      status: 'pending',
    };
    const frozenResults = {
      loadPendingRequest: vi.fn().mockResolvedValue(request),
      markRejected: vi.fn().mockResolvedValue(undefined),
    };
    const matches = {
      approveFrozenExchangeEdit: vi.fn(),
    };
    const service = new ExchangeEditRequestsAdminService(frozenResults as never, matches as never);

    const result = await service.reject('request-1', 'super-1', 'Not enough evidence');

    expect(matches.approveFrozenExchangeEdit).not.toHaveBeenCalled();
    expect(frozenResults.markRejected).toHaveBeenCalledWith(
      request,
      'super-1',
      'Not enough evidence',
    );
    expect(result).toEqual({ rejected: true, requestId: 'request-1' });
  });
});
