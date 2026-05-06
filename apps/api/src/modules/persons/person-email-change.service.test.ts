import { BadRequestException, ConflictException, UnauthorizedException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PersonEmailChangeService } from './person-email-change.service';

const getUserMock = vi.fn();
const updateUserByIdMock = vi.fn();
const fromMock = vi.fn();
const sendEmailChangeConfirmationMock = vi.fn();

const mockSupabase = {
  anon: {
    auth: {
      getUser: getUserMock,
    },
  },
  service: {
    auth: {
      admin: {
        updateUserById: updateUserByIdMock,
      },
    },
    from: fromMock,
  },
};

const mockMail = {
  sendEmailChangeConfirmation: sendEmailChangeConfirmationMock,
};

const mockConfig = {
  get: vi.fn((key: string, fallback?: string) => {
    const values: Record<string, string> = {
      DOMAIN: 'myclash.localhost',
    };
    return values[key] ?? fallback ?? '';
  }),
};

function makeRequest(token?: string) {
  return {
    headers: token ? { authorization: `Bearer ${token}` } : ({} as Record<string, string>),
    cookies: token ? { 'sb-access-token': token } : ({} as Record<string, string>),
  };
}

function makeSelectChain(result: unknown) {
  const chain = Promise.resolve(result) as Promise<unknown> & Record<string, unknown>;
  const methods = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    ilike: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
  };
  Object.assign(chain, methods);
  return chain as unknown as typeof methods;
}

function makeUpdateChain(result: unknown) {
  return {
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(result),
  };
}

function makeInsertChain(result: unknown) {
  return {
    insert: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(result),
  };
}

const claimedPersons = [
  { id: 'person-1', event_id: 'event-1', email: 'old@example.com' },
  { id: 'person-2', event_id: 'event-2', email: 'old@example.com' },
];

describe('PersonEmailChangeService', () => {
  let service: PersonEmailChangeService;

  beforeEach(() => {
    vi.clearAllMocks();
    getUserMock.mockResolvedValue({
      data: { user: { id: 'user-1', email: 'old@example.com' } },
      error: null,
    });
    updateUserByIdMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });

    service = new PersonEmailChangeService(
      mockSupabase as never,
      mockMail as never,
      mockConfig as never,
    );
  });

  it('rejects anonymous requests', async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: { message: 'no session' } });

    await expect(
      service.requestEmailChange(makeRequest(), { newEmail: 'new@example.com' }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejects users without claimed Person rows', async () => {
    fromMock.mockReturnValueOnce(makeSelectChain({ data: [], error: null }));

    await expect(
      service.requestEmailChange(makeRequest('token'), { newEmail: 'new@example.com' }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejects invalid and unchanged email values', async () => {
    await expect(
      service.requestEmailChange(makeRequest('token'), { newEmail: 'not-an-email' }),
    ).rejects.toThrow(BadRequestException);

    await expect(
      service.requestEmailChange(makeRequest('token'), { newEmail: 'OLD@example.com' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a new email already used by another Person in any claimed event', async () => {
    fromMock
      .mockReturnValueOnce(makeSelectChain({ data: claimedPersons, error: null }))
      .mockReturnValueOnce(makeSelectChain({ data: { id: 'other-person' }, error: null }));

    await expect(
      service.requestEmailChange(makeRequest('token'), { newEmail: 'other@example.com' }),
    ).rejects.toThrow(ConflictException);
  });

  it('stores only a token hash and sends confirmation to the new email', async () => {
    const cancelChain = makeUpdateChain({ data: null, error: null });
    const insertChain = makeInsertChain({
      data: {
        id: 'request-1',
        new_email: 'new@example.com',
        expires_at: '2026-05-06T16:00:00.000Z',
      },
      error: null,
    });

    fromMock
      .mockReturnValueOnce(makeSelectChain({ data: claimedPersons, error: null }))
      .mockReturnValueOnce(makeSelectChain({ data: null, error: null }))
      .mockReturnValueOnce(makeSelectChain({ data: null, error: null }))
      .mockReturnValueOnce(cancelChain)
      .mockReturnValueOnce(insertChain);

    await service.requestEmailChange(makeRequest('token'), { newEmail: 'New@Example.com' });

    const inserted = insertChain.insert.mock.calls[0]![0] as Record<string, string>;
    const confirmUrl = sendEmailChangeConfirmationMock.mock.calls[0]![0].confirmUrl as string;
    const token = new URL(confirmUrl).searchParams.get('token');

    expect(inserted['new_email']).toBe('new@example.com');
    expect(inserted['token_hash']).toHaveLength(64);
    expect(inserted['token_hash']).not.toBe(token);
    expect(inserted['token_hash']).not.toContain('new@example.com');
    expect(sendEmailChangeConfirmationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'new@example.com',
        oldEmail: 'old@example.com',
        newEmail: 'new@example.com',
      }),
    );
  });

  it('replaces an existing pending request for the same user', async () => {
    const cancelChain = makeUpdateChain({ data: null, error: null });
    const insertChain = makeInsertChain({
      data: { id: 'request-2', new_email: 'new@example.com', expires_at: 'soon' },
      error: null,
    });

    fromMock
      .mockReturnValueOnce(makeSelectChain({ data: claimedPersons, error: null }))
      .mockReturnValueOnce(makeSelectChain({ data: null, error: null }))
      .mockReturnValueOnce(makeSelectChain({ data: null, error: null }))
      .mockReturnValueOnce(cancelChain)
      .mockReturnValueOnce(insertChain);

    await service.requestEmailChange(makeRequest('token'), { newEmail: 'new@example.com' });

    expect(cancelChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ cancelled_at: expect.any(String) }),
    );
    expect(cancelChain.eq).toHaveBeenCalledWith('user_id', 'user-1');
    expect(cancelChain.is).toHaveBeenCalledWith('confirmed_at', null);
    expect(cancelChain.is).toHaveBeenCalledWith('cancelled_at', null);
  });

  it('rejects expired, missing, or reused confirmation tokens', async () => {
    fromMock.mockReturnValueOnce(makeSelectChain({ data: null, error: null }));
    await expect(service.confirmEmailChange('missing-token')).rejects.toThrow(BadRequestException);

    fromMock.mockReturnValueOnce(
      makeSelectChain({
        data: {
          id: 'request-1',
          user_id: 'user-1',
          old_email: 'old@example.com',
          new_email: 'new@example.com',
          expires_at: '2020-01-01T00:00:00.000Z',
          confirmed_at: null,
          cancelled_at: null,
        },
        error: null,
      }),
    );
    await expect(service.confirmEmailChange('expired-token')).rejects.toThrow(BadRequestException);

    fromMock.mockReturnValueOnce(
      makeSelectChain({
        data: {
          id: 'request-1',
          user_id: 'user-1',
          old_email: 'old@example.com',
          new_email: 'new@example.com',
          expires_at: '2099-01-01T00:00:00.000Z',
          confirmed_at: '2026-05-06T15:00:00.000Z',
          cancelled_at: null,
        },
        error: null,
      }),
    );
    await expect(service.confirmEmailChange('used-token')).rejects.toThrow(BadRequestException);
  });

  it('confirms by updating auth email, all claimed Person rows, request state, and audit log', async () => {
    const request = {
      id: 'request-1',
      user_id: 'user-1',
      old_email: 'old@example.com',
      new_email: 'new@example.com',
      expires_at: '2099-01-01T00:00:00.000Z',
      confirmed_at: null,
      cancelled_at: null,
    };
    const confirmChain = makeUpdateChain({ data: null, error: null });
    const personsUpdateChain = makeUpdateChain({ data: null, error: null });
    const auditInsertChain = makeInsertChain({ data: null, error: null });

    fromMock
      .mockReturnValueOnce(makeSelectChain({ data: request, error: null }))
      .mockReturnValueOnce(confirmChain)
      .mockReturnValueOnce(personsUpdateChain)
      .mockReturnValueOnce(auditInsertChain);

    const result = await service.confirmEmailChange('valid-token');

    expect(updateUserByIdMock).toHaveBeenCalledWith('user-1', { email: 'new@example.com' });
    expect(personsUpdateChain.update).toHaveBeenCalledWith({
      email: 'new@example.com',
      updated_at: expect.any(String),
    });
    expect(personsUpdateChain.eq).toHaveBeenCalledWith('claimed_by_user_id', 'user-1');
    expect(confirmChain.update).toHaveBeenCalledWith({ confirmed_at: expect.any(String) });
    expect(auditInsertChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        actor_user_id: 'user-1',
        action: 'person.email_change_confirmed',
        entity_type: 'user',
        entity_id: 'user-1',
      }),
    );
    expect(result).toEqual({ email: 'new@example.com' });
  });

  it('leaves request unconfirmed when Supabase Auth email update fails', async () => {
    updateUserByIdMock.mockResolvedValue({ data: null, error: { message: 'auth failed' } });
    fromMock.mockReturnValueOnce(
      makeSelectChain({
        data: {
          id: 'request-1',
          user_id: 'user-1',
          old_email: 'old@example.com',
          new_email: 'new@example.com',
          expires_at: '2099-01-01T00:00:00.000Z',
          confirmed_at: null,
          cancelled_at: null,
        },
        error: null,
      }),
    );

    await expect(service.confirmEmailChange('valid-token')).rejects.toThrow(BadRequestException);
    expect(fromMock).toHaveBeenCalledTimes(1);
  });
});
