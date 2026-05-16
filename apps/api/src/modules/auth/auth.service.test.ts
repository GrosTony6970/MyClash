import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { GuestJwtService } from './guest-jwt.service';

// ── Mocks ──────────────────────────────────────────────────────────────────

const generateLinkMock = vi.fn();
const getUserMock = vi.fn();
const signInWithPasswordMock = vi.fn();
const fromMock = vi.fn();
const fetchMock = vi.fn();

const mockSupabase = {
  service: {
    auth: { admin: { generateLink: generateLinkMock } },
    from: fromMock,
  },
  anon: {
    auth: { getUser: getUserMock, signInWithPassword: signInWithPasswordMock, verifyOtp: vi.fn() },
  },
};

function makeQueryChain(result: unknown) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
    update: vi.fn().mockReturnThis(),
  };
}

const mockMailService = {
  sendMagicLink: vi.fn().mockResolvedValue(undefined),
};

const mockConfigService = {
  getOrThrow: vi.fn(),
  get: vi.fn((key: string, def?: string) => {
    const values: Record<string, string> = {
      DOMAIN: 'myclash.localhost',
      MAIL_FROM: 'noreply@myclash.fr',
      SUPABASE_AUTH_INTERNAL_URL: 'http://supabase-auth:9999',
    };
    return values[key] ?? def ?? '';
  }),
};

const mockOnboarding = {
  completeSignupAfterMagicLink: vi.fn().mockResolvedValue(undefined),
};

function makeReply() {
  return {
    setCookie: vi.fn(),
    send: vi.fn(),
    redirect: vi.fn(),
  };
}

function mockAuthUser(user: Record<string, unknown>) {
  fetchMock.mockResolvedValue({
    ok: true,
    json: vi.fn().mockResolvedValue(user),
  });
}

// Real GuestJwtService for integration-style tests
const guestJwtService = new GuestJwtService({
  getOrThrow: () => 'test-guest-secret-at-least-32-chars-long',
} as never);

// ── Tests ──────────────────────────────────────────────────────────────────

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    mockConfigService.getOrThrow.mockImplementation((key: string) => {
      const values: Record<string, string> = {
        SUPABASE_URL: 'https://app.myclash.fr',
        SUPABASE_ANON_KEY: 'anon-key',
      };
      const value = values[key];
      if (!value) throw new Error(`Missing config ${key}`);
      return value;
    });
    fromMock.mockReturnValue(makeQueryChain({ data: null, error: null }));

    service = new AuthService(
      mockSupabase as never,
      mockMailService as never,
      mockConfigService as never,
      guestJwtService,
      mockOnboarding as never,
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('requestMagicLink — login type', () => {
    it('returns generic message on success', async () => {
      generateLinkMock.mockResolvedValue({
        data: { properties: { action_link: 'https://example.com/magic' } },
        error: null,
      });

      const result = await service.requestMagicLink({
        email: 'organizer@example.com',
        type: 'login',
      });

      expect(result.message).toContain('link has been sent');
      expect(mockMailService.sendMagicLink).toHaveBeenCalledOnce();
    });

    it('returns generic message even when Supabase fails (no email enumeration)', async () => {
      generateLinkMock.mockResolvedValue({
        data: { properties: {} },
        error: { message: 'User not found' },
      });

      const result = await service.requestMagicLink({
        email: 'unknown@example.com',
        type: 'login',
      });

      expect(result.message).toContain('link has been sent');
      expect(mockMailService.sendMagicLink).not.toHaveBeenCalled();
    });
  });

  describe('requestMagicLink — claim type', () => {
    it('throws BadRequestException when personId is missing', async () => {
      await expect(
        service.requestMagicLink({ email: 'jean@example.com', type: 'claim' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getMe', () => {
    it('returns anonymous when no token present', async () => {
      const mockRequest = { headers: {}, cookies: {} } as never;
      const result = await service.getMe(mockRequest);
      expect(result.type).toBe('anonymous');
    });

    it('returns claimed when valid Supabase token present', async () => {
      mockAuthUser({
        id: 'user-123',
        email: 'organizer@example.com',
        user_metadata: { display_name: 'Jean Dupont' },
      });

      const mockRequest = {
        headers: { authorization: 'Bearer valid-token' },
        cookies: {},
      } as never;

      const result = await service.getMe(mockRequest);
      expect(fetchMock).toHaveBeenCalledWith(
        'http://supabase-auth:9999/user',
        expect.objectContaining({
          method: 'GET',
          headers: {
            apikey: 'anon-key',
            Authorization: 'Bearer valid-token',
          },
        }),
      );
      expect(getUserMock).not.toHaveBeenCalled();
      expect(result.type).toBe('claimed');
      expect(result.user?.email).toBe('organizer@example.com');
    });

    it('returns anonymous when Supabase token is invalid', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        json: vi.fn().mockResolvedValue({ error: 'invalid_token' }),
      });

      const mockRequest = {
        headers: { authorization: 'Bearer bad-token' },
        cookies: {},
      } as never;

      const result = await service.getMe(mockRequest);
      expect(result.type).toBe('anonymous');
      expect(getUserMock).not.toHaveBeenCalled();
    });

    it('returns guest when valid mc_guest cookie present (no Supabase token)', async () => {
      const sessionChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            id: 'session-1',
            device_label: 'iPhone (Safari)',
            expires_at: new Date(Date.now() + 3600000).toISOString(),
            revoked_at: null,
          },
          error: null,
        }),
      };
      const personChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            id: 'person-1',
            given_name: 'Jean',
            family_name: 'Dupont',
            event_id: 'event-1',
            claim_status: 'unclaimed',
          },
          error: null,
        }),
      };
      fromMock.mockReturnValueOnce(sessionChain).mockReturnValueOnce(personChain);

      const expiresAt = new Date(Date.now() + 3600000);
      const guestToken = guestJwtService.sign(
        { sub: 'session-1', person_id: 'person-1', event_id: 'event-1', type: 'guest' },
        expiresAt,
      );

      const mockRequest = {
        headers: {},
        cookies: { mc_guest: guestToken },
      } as never;

      const result = await service.getMe(mockRequest);
      expect(result.type).toBe('guest');
      expect(result.session?.device_label).toBe('iPhone (Safari)');
      expect(result.person?.given_name).toBe('Jean');
      expect(fetchMock).not.toHaveBeenCalled();
      expect(getUserMock).not.toHaveBeenCalled();
    });

    it('claimed wins when both Supabase token and guest cookie present; clears guest cookie', async () => {
      mockAuthUser({
        id: 'user-123',
        email: 'organizer@example.com',
        user_metadata: {},
      });

      const expiresAt = new Date(Date.now() + 3600000);
      const guestToken = guestJwtService.sign(
        { sub: 'session-1', person_id: 'person-1', event_id: 'event-1', type: 'guest' },
        expiresAt,
      );

      const clearCookieMock = vi.fn();
      const mockReply = { clearCookie: clearCookieMock } as never;

      const mockRequest = {
        headers: { authorization: 'Bearer valid-token' },
        cookies: { mc_guest: guestToken },
      } as never;

      const result = await service.getMe(mockRequest, mockReply);
      expect(result.type).toBe('claimed');
      expect(getUserMock).not.toHaveBeenCalled();
      expect(clearCookieMock).toHaveBeenCalledWith(
        'mc_guest',
        expect.objectContaining({ sameSite: 'lax', path: '/' }),
      );
    });
  });

  describe('acceptOAuthSession', () => {
    it('sets cookies for an existing organizer member', async () => {
      mockAuthUser({ id: 'user-123', email: 'org@example.com' });

      fromMock
        .mockReturnValueOnce(makeQueryChain({ data: null, error: null }))
        .mockReturnValueOnce(makeQueryChain({ data: { role: 'owner' }, error: null }));

      const reply = makeReply();
      await service.acceptOAuthSession(
        {
          accessToken: 'access-token',
          refreshToken: 'refresh-token',
          mode: 'admin_login',
        },
        reply as never,
      );

      expect(reply.setCookie).toHaveBeenCalledWith(
        'sb-access-token',
        'access-token',
        expect.objectContaining({ httpOnly: true }),
      );
      expect(reply.setCookie).toHaveBeenCalledWith(
        'sb-refresh-token',
        'refresh-token',
        expect.objectContaining({ httpOnly: true }),
      );
      expect(reply.send).toHaveBeenCalledWith({ next: '/dashboard' });
      expect(fetchMock).toHaveBeenCalledWith(
        'http://supabase-auth:9999/user',
        expect.objectContaining({
          method: 'GET',
          headers: {
            apikey: 'anon-key',
            Authorization: 'Bearer access-token',
          },
        }),
      );
      expect(getUserMock).not.toHaveBeenCalled();
    });

    it('rejects admin OAuth when user has no organization or platform role', async () => {
      mockAuthUser({ id: 'user-123', email: 'outsider@example.com' });
      fromMock
        .mockReturnValueOnce(makeQueryChain({ data: null, error: null }))
        .mockReturnValueOnce(makeQueryChain({ data: null, error: null }));

      await expect(
        service.acceptOAuthSession(
          {
            accessToken: 'access-token',
            refreshToken: 'refresh-token',
            mode: 'admin_login',
          },
          makeReply() as never,
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(getUserMock).not.toHaveBeenCalled();
    });

    it('creates organizer signup membership after Google session validation', async () => {
      mockAuthUser({ id: 'user-123', email: 'new@example.com' });
      const reply = makeReply();

      await service.acceptOAuthSession(
        {
          accessToken: 'access-token',
          refreshToken: 'refresh-token',
          mode: 'organizer_signup',
          orgName: 'Lyon AMHE',
          orgSlug: 'lyon-amhe',
        },
        reply as never,
      );

      expect(mockOnboarding.completeSignupAfterMagicLink).toHaveBeenCalledWith(
        'user-123',
        'Lyon AMHE',
        'lyon-amhe',
      );
      expect(reply.send).toHaveBeenCalledWith({ next: '/org/lyon-amhe' });
      expect(getUserMock).not.toHaveBeenCalled();
    });

    it('claims a Person when Google email matches the registered email', async () => {
      mockAuthUser({ id: 'user-123', email: 'jean@example.com' });
      const personChain = makeQueryChain({
        data: { id: 'person-1', email: 'jean@example.com', claim_status: 'unclaimed' },
        error: null,
      });
      const updateChain = makeQueryChain({ data: null, error: null });
      fromMock.mockReturnValueOnce(personChain).mockReturnValueOnce(updateChain);

      const reply = makeReply();
      await service.acceptOAuthSession(
        {
          accessToken: 'access-token',
          refreshToken: 'refresh-token',
          mode: 'person_claim',
          personId: '00000000-0000-0000-0000-000000000001',
        },
        reply as never,
      );

      expect(updateChain.update).toHaveBeenCalledWith({
        claim_status: 'claimed',
        claimed_by_user_id: 'user-123',
      });
      expect(reply.send).toHaveBeenCalledWith({ next: '/' });
      expect(getUserMock).not.toHaveBeenCalled();
    });

    it('rejects person claim when Google email does not match', async () => {
      mockAuthUser({ id: 'user-123', email: 'other@example.com' });
      fromMock.mockReturnValueOnce(
        makeQueryChain({
          data: { id: 'person-1', email: 'jean@example.com', claim_status: 'unclaimed' },
          error: null,
        }),
      );

      await expect(
        service.acceptOAuthSession(
          {
            accessToken: 'access-token',
            refreshToken: 'refresh-token',
            mode: 'person_claim',
            personId: '00000000-0000-0000-0000-000000000001',
          },
          makeReply() as never,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(getUserMock).not.toHaveBeenCalled();
    });

    it('rejects OAuth when internal GoTrue rejects the access token', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        json: vi.fn().mockResolvedValue({ error: 'invalid_token' }),
      });

      await expect(
        service.acceptOAuthSession(
          {
            accessToken: 'bad-token',
            refreshToken: 'refresh-token',
            mode: 'admin_login',
          },
          makeReply() as never,
        ),
      ).rejects.toThrow(UnauthorizedException);
      expect(fromMock).not.toHaveBeenCalled();
      expect(getUserMock).not.toHaveBeenCalled();
    });
  });

  describe('passwordLogin', () => {
    it('sets cookies and redirects to dashboard for a super admin', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          access_token: 'password-access-token',
          refresh_token: 'password-refresh-token',
          expires_in: 3600,
          user: { id: 'admin-123', email: 'admin@example.com' },
        }),
      });
      fromMock.mockReturnValueOnce(makeQueryChain({ data: { role: 'super_admin' }, error: null }));

      const reply = makeReply();
      await service.passwordLogin(
        {
          email: 'admin@example.com',
          password: 'correct-password',
        },
        reply as never,
      );

      expect(fetchMock).toHaveBeenCalledWith(
        'http://supabase-auth:9999/token?grant_type=password',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: 'anon-key',
          },
          body: JSON.stringify({
            email: 'admin@example.com',
            password: 'correct-password',
          }),
        }),
      );
      expect(signInWithPasswordMock).not.toHaveBeenCalled();
      expect(reply.setCookie).toHaveBeenCalledWith(
        'sb-access-token',
        'password-access-token',
        expect.objectContaining({ httpOnly: true }),
      );
      expect(reply.setCookie).toHaveBeenCalledWith(
        'sb-refresh-token',
        'password-refresh-token',
        expect.objectContaining({ httpOnly: true }),
      );
      expect(reply.send).toHaveBeenCalledWith({ next: '/dashboard' });
    });

    it('rejects invalid password credentials', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        json: vi.fn().mockResolvedValue({ error: 'invalid_grant' }),
      });

      await expect(
        service.passwordLogin(
          {
            email: 'admin@example.com',
            password: 'wrong-password',
          },
          makeReply() as never,
        ),
      ).rejects.toThrow(UnauthorizedException);
      expect(fromMock).not.toHaveBeenCalled();
      expect(signInWithPasswordMock).not.toHaveBeenCalled();
    });

    it('rejects password login when the user has no admin access', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          access_token: 'access-token',
          refresh_token: 'refresh-token',
          expires_in: 3600,
          user: { id: 'user-123', email: 'person@example.com' },
        }),
      });
      fromMock
        .mockReturnValueOnce(makeQueryChain({ data: null, error: null }))
        .mockReturnValueOnce(makeQueryChain({ data: null, error: null }));

      await expect(
        service.passwordLogin(
          {
            email: 'person@example.com',
            password: 'valid-password',
          },
          makeReply() as never,
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(signInWithPasswordMock).not.toHaveBeenCalled();
    });
  });
});
