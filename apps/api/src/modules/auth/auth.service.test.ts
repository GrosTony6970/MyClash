import { createHash } from 'node:crypto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { LegalAcceptanceService } from '../privacy/legal-acceptance.service';
import { AuthService } from './auth.service';
import { GuestJwtService } from './guest-jwt.service';

// ── Mocks ──────────────────────────────────────────────────────────────────

const generateLinkMock = vi.fn();
const getUserMock = vi.fn();
const signInWithPasswordMock = vi.fn();
const fromMock = vi.fn();
const fetchMock = vi.fn();
const getAuthUserMock = vi.fn();
const refreshSessionMock = vi.fn();

const mockSupabase = {
  getAuthUser: getAuthUserMock,
  refreshSession: refreshSessionMock,
  service: {
    auth: {
      admin: {
        generateLink: generateLinkMock,
        deleteUser: vi.fn().mockResolvedValue({ error: null }),
      },
    },
    from: fromMock,
  },
  anon: {
    auth: { getUser: getUserMock, signInWithPassword: signInWithPasswordMock, verifyOtp: vi.fn() },
  },
};

function makeQueryChain(result: unknown) {
  const resolved = result && typeof result === 'object' ? (result as Record<string, unknown>) : {};
  return {
    ...resolved,
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    ilike: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
  };
}

function makeAwaitableQueryChain(result: unknown) {
  const chain = Object.assign(Promise.resolve(result), {
    select: vi.fn(),
    eq: vi.fn(),
    is: vi.fn(),
    ilike: vi.fn(),
    in: vi.fn(),
    limit: vi.fn(),
    order: vi.fn(),
    update: vi.fn(),
  });
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.is.mockReturnValue(chain);
  chain.ilike.mockReturnValue(chain);
  chain.in.mockReturnValue(chain);
  chain.limit.mockReturnValue(chain);
  chain.order.mockReturnValue(chain);
  chain.update.mockReturnValue(chain);
  return chain;
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

/**
 * ErasureService owns what account deletion actually removes; AuthService only
 * sequences it around the auth-user delete. These tests pin that sequencing —
 * the redaction itself is covered in privacy/erasure.service.test.ts.
 */
const mockErasure = {
  redactSubject: vi.fn().mockResolvedValue({ persons: 1 }),
  recordErasure: vi.fn().mockResolvedValue(undefined),
};

/**
 * Stubbed, not real: `buildClaimedResponse` drives ordered `mockReturnValueOnce`
 * chains on the Supabase mock, and a real LegalAcceptanceService would issue one
 * more `from()` at the end of every getMe test. The acceptance logic has its own
 * tests in privacy/legal-acceptance.service.test.ts.
 */
const legalService = {
  assertCurrent: vi.fn((accepted: { terms?: string; privacy?: string }) => ({
    terms: accepted.terms ?? 'v',
    privacy: accepted.privacy ?? 'v',
  })),
  currentVersions: vi.fn(() => ({ terms: 'v', privacy: 'v' })),
  recordForUser: vi.fn().mockResolvedValue(undefined),
  pendingFor: vi.fn().mockResolvedValue([]),
  summaryFor: vi.fn().mockResolvedValue([]),
} as unknown as LegalAcceptanceService;

function makeReply() {
  return {
    setCookie: vi.fn(),
    clearCookie: vi.fn(),
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
    refreshSessionMock.mockResolvedValue(null);
    getAuthUserMock.mockImplementation(async (accessToken: string) => {
      const response = await fetchMock('http://supabase-auth:9999/user', {
        method: 'GET',
        headers: {
          apikey: 'anon-key',
          Authorization: `Bearer ${accessToken}`,
        },
      });
      const body = (await response.json()) as unknown;
      if (!response.ok || !body || typeof body !== 'object') return null;
      const record = body as Record<string, unknown>;
      const user = record['user'];
      if (typeof record['id'] === 'string') return record;
      if (user && typeof user === 'object' && typeof (user as { id?: unknown }).id === 'string') {
        return user;
      }
      return null;
    });

    service = new AuthService(
      mockSupabase as never,
      mockMailService as never,
      mockConfigService as never,
      mockErasure as never,
      legalService,
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

    it('builds app-domain callbacks for public personal-space login', async () => {
      generateLinkMock.mockResolvedValue({
        data: { properties: { action_link: 'https://example.com/magic' } },
        error: null,
      });

      await service.requestMagicLink({
        email: 'fighter@example.com',
        type: 'public_login',
        redirectTo: '/me',
      });

      expect(generateLinkMock).toHaveBeenCalledWith(
        expect.objectContaining({
          options: {
            redirectTo:
              'https://api.myclash.localhost/api/v1/auth/callback?type=public_login&next=%2Fme',
          },
        }),
      );
      expect(mockMailService.sendMagicLink).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'fighter@example.com',
          type: 'login',
        }),
      );
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
      expect(result.admin).toEqual({
        isSuperAdmin: false,
        organizations: [],
        hasLeagueRoles: false,
      });
    });

    it('includes the claimed user global profile photo when linked', async () => {
      mockAuthUser({
        id: 'user-123',
        email: 'fighter@example.com',
        user_metadata: { display_name: 'Fighter One' },
      });

      fromMock
        .mockReturnValueOnce(makeQueryChain({ data: null, error: null })) // persons
        .mockReturnValueOnce(makeQueryChain({ data: null, error: null })) // super_admin check
        .mockReturnValueOnce(makeAwaitableQueryChain({ data: [], error: null })) // orgs list
        .mockReturnValueOnce(
          makeQueryChain({ data: { photo_url: 'https://cdn.example/avatar.jpg' }, error: null }),
        ); // global_persons photo (last)

      const result = await service.getMe({
        headers: { authorization: 'Bearer valid-token' },
        cookies: {},
      } as never);

      expect(result.type).toBe('claimed');
      expect(result.user?.photo_url).toBe('https://cdn.example/avatar.jpg');
    });

    it('returns super-admin landing context for platform admins', async () => {
      mockAuthUser({
        id: 'admin-123',
        email: 'admin@example.com',
        user_metadata: { display_name: 'Super Admin' },
      });

      fromMock
        .mockReturnValueOnce(makeQueryChain({ data: null, error: null }))
        .mockReturnValueOnce(makeQueryChain({ data: { role: 'super_admin' }, error: null }))
        .mockReturnValueOnce(makeAwaitableQueryChain({ data: [], error: null }));

      const result = await service.getMe({
        headers: { authorization: 'Bearer admin-token' },
        cookies: {},
      } as never);

      expect(result.type).toBe('claimed');
      expect(result.admin).toEqual({
        isSuperAdmin: true,
        organizations: [],
        hasLeagueRoles: false,
      });
    });

    it('returns organization landing context for organizer users', async () => {
      mockAuthUser({
        id: 'organizer-123',
        email: 'organizer@example.com',
        user_metadata: {},
      });

      fromMock
        .mockReturnValueOnce(makeQueryChain({ data: null, error: null }))
        .mockReturnValueOnce(makeQueryChain({ data: null, error: null }))
        .mockReturnValueOnce(
          makeAwaitableQueryChain({
            data: [
              {
                role: 'owner',
                organizations: { id: 'org-1', slug: 'lyon-amhe' },
              },
              {
                role: 'admin',
                organizations: [{ id: 'org-2', slug: 'paris-hema' }],
              },
            ],
            error: null,
          }),
        );

      const result = await service.getMe({
        headers: { authorization: 'Bearer organizer-token' },
        cookies: {},
      } as never);

      expect(result.type).toBe('claimed');
      expect(result.admin).toEqual({
        isSuperAdmin: false,
        organizations: [
          { id: 'org-1', slug: 'lyon-amhe', role: 'owner' },
          { id: 'org-2', slug: 'paris-hema', role: 'admin' },
        ],
        hasLeagueRoles: false,
      });
    });

    // Drives the "My leagues" nav entry and the /dashboard league branch, so it
    // must be true for an account holding only a personal league grant.
    it('reports hasLeagueRoles for an account with a direct league grant', async () => {
      mockAuthUser({ id: 'league-admin-1', email: 'league@example.com', user_metadata: {} });

      fromMock
        .mockReturnValueOnce(makeQueryChain({ data: null, error: null })) // persons
        .mockReturnValueOnce(makeQueryChain({ data: null, error: null })) // super_admin check
        .mockReturnValueOnce(makeAwaitableQueryChain({ data: [], error: null })) // orgs list
        .mockReturnValueOnce(makeQueryChain({ data: null, error: null })) // photo
        .mockReturnValueOnce(makeQueryChain({ data: [{ role: 'admin' }], error: null }));

      const result = await service.getMe({
        headers: { authorization: 'Bearer league-token' },
        cookies: {},
      } as never);

      expect(result.admin).toEqual({
        isSuperAdmin: false,
        organizations: [],
        hasLeagueRoles: true,
      });
    });

    it('does not query league roles for an anonymous visitor', async () => {
      getAuthUserMock.mockResolvedValue(null);

      const result = await service.getMe({ headers: {}, cookies: {} } as never);

      expect(result.type).toBe('anonymous');
      expect(fromMock).not.toHaveBeenCalled();
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

    it('refreshes an expired session from the refresh-token cookie (sliding session)', async () => {
      // The current access token is expired/invalid → null; the freshly minted
      // one validates to a real user.
      getAuthUserMock.mockImplementation(async (token: string) =>
        token === 'fresh-access'
          ? { id: 'user-9', email: 'organizer@example.com', user_metadata: {} }
          : null,
      );
      refreshSessionMock.mockResolvedValue({
        access_token: 'fresh-access',
        refresh_token: 'fresh-refresh',
        expires_in: 3600,
      });

      const reply = makeReply();
      const result = await service.getMe(
        {
          headers: { authorization: 'Bearer expired-token' },
          cookies: { 'sb-refresh-token': 'old-refresh' },
        } as never,
        reply as never,
      );

      expect(refreshSessionMock).toHaveBeenCalledWith('old-refresh');
      expect(reply.setCookie).toHaveBeenCalledWith(
        'sb-access-token',
        'fresh-access',
        expect.objectContaining({ maxAge: 2592000 }),
      );
      expect(reply.setCookie).toHaveBeenCalledWith(
        'sb-refresh-token',
        'fresh-refresh',
        expect.objectContaining({ maxAge: 2592000 }),
      );
      expect(result.type).toBe('claimed');
      expect(result.user?.email).toBe('organizer@example.com');
    });

    it('stays anonymous (and sets no cookies) when the refresh token is invalid', async () => {
      getAuthUserMock.mockResolvedValue(null);
      refreshSessionMock.mockResolvedValue(null);

      const reply = makeReply();
      const result = await service.getMe(
        { headers: {}, cookies: { 'sb-refresh-token': 'bad-refresh' } } as never,
        reply as never,
      );

      expect(refreshSessionMock).toHaveBeenCalledWith('bad-refresh');
      expect(reply.setCookie).not.toHaveBeenCalled();
      expect(result.type).toBe('anonymous');
    });

    it('sets the refreshed cookies but returns anonymous if the new token fails to validate (self-heals next request)', async () => {
      // refresh succeeds (cookies written) but re-validation of the new token
      // returns null (e.g. GoTrue race). No loop; the next request authenticates.
      getAuthUserMock.mockResolvedValue(null);
      refreshSessionMock.mockResolvedValue({
        access_token: 'fresh-access',
        refresh_token: 'fresh-refresh',
        expires_in: 3600,
      });

      const reply = makeReply();
      const result = await service.getMe(
        { headers: {}, cookies: { 'sb-refresh-token': 'r' } } as never,
        reply as never,
      );

      expect(reply.setCookie).toHaveBeenCalledWith(
        'sb-access-token',
        'fresh-access',
        expect.anything(),
      );
      expect(result.type).toBe('anonymous');
    });

    it('does not attempt a refresh when no reply is available to persist new cookies', async () => {
      getAuthUserMock.mockResolvedValue(null);

      const result = await service.getMe({
        headers: { authorization: 'Bearer expired-token' },
        cookies: { 'sb-refresh-token': 'old-refresh' },
      } as never);

      expect(refreshSessionMock).not.toHaveBeenCalled();
      expect(result.type).toBe('anonymous');
    });
  });

  describe('acceptOAuthSession', () => {
    it('sets cookies for an existing organizer member', async () => {
      mockAuthUser({ id: 'user-123', email: 'org@example.com' });

      fromMock
        .mockReturnValueOnce(makeQueryChain({ data: null, error: null }))
        // organization_members is read with .limit(1), so it resolves to an array.
        .mockReturnValueOnce(makeQueryChain({ data: [{ role: 'owner' }], error: null }));

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
        expect.objectContaining({ httpOnly: true, maxAge: 2592000 }),
      );
      expect(reply.setCookie).toHaveBeenCalledWith(
        'sb-refresh-token',
        'refresh-token',
        expect.objectContaining({ httpOnly: true, maxAge: 2592000 }),
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

    it('rejects admin OAuth when user has no organization, platform or league role', async () => {
      mockAuthUser({ id: 'user-123', email: 'outsider@example.com' });
      fromMock
        .mockReturnValueOnce(makeQueryChain({ data: null, error: null })) // platform_roles
        .mockReturnValueOnce(makeQueryChain({ data: [], error: null })) // organization_members
        .mockReturnValueOnce(makeQueryChain({ data: [], error: null })); // league_user_roles

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

    // The lower platform tiers exist ONLY as platform_roles rows — no org, no
    // league grant. If this login gate stayed super-admin-exact they could not
    // reach the console at all and the whole feature would be invisible.
    it.each(['platform_admin', 'platform_viewer'])(
      'sets cookies for a %s whose only grant is the platform role',
      async (role) => {
        mockAuthUser({ id: `${role}-1`, email: `${role}@example.com` });
        fromMock
          .mockReturnValueOnce(makeQueryChain({ data: { role }, error: null })) // platform_roles
          .mockReturnValueOnce(makeQueryChain({ data: [], error: null })) // organization_members
          .mockReturnValueOnce(makeQueryChain({ data: [], error: null })); // league_user_roles

        const reply = makeReply();
        await service.acceptOAuthSession(
          { accessToken: 'access-token', refreshToken: 'refresh-token', mode: 'admin_login' },
          reply as never,
        );

        expect(reply.setCookie).toHaveBeenCalledWith(
          'sb-access-token',
          'access-token',
          expect.objectContaining({ httpOnly: true }),
        );
      },
    );

    // A league can be administered by an account that belongs to no org.
    // assertCanManageLeague already authorizes these users on every
    // /admin/leagues/* endpoint, so login must not be what blocks them.
    it('sets cookies for an account whose only grant is a direct league role', async () => {
      mockAuthUser({ id: 'league-admin-1', email: 'league@example.com' });
      fromMock
        .mockReturnValueOnce(makeQueryChain({ data: null, error: null })) // platform_roles
        .mockReturnValueOnce(makeQueryChain({ data: [], error: null })) // organization_members
        .mockReturnValueOnce(makeQueryChain({ data: [{ role: 'admin' }], error: null }));

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
        expect.objectContaining({ httpOnly: true, maxAge: 2592000 }),
      );
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
      const claimedPersonChain = makeQueryChain({
        data: { global_person_id: 'global-1' },
        error: null,
      });
      const existingGlobalChain = makeQueryChain({ data: null, error: null });
      const targetGlobalChain = makeQueryChain({
        data: { id: 'global-1', claimed_by_user_id: null },
        error: null,
      });
      const globalUpdateChain = makeQueryChain({ data: null, error: null });
      const existingGlobalAfterOAuthChain = makeQueryChain({
        data: { id: 'global-1' },
        error: null,
      });
      fromMock
        .mockReturnValueOnce(personChain)
        .mockReturnValueOnce(updateChain)
        .mockReturnValueOnce(claimedPersonChain)
        .mockReturnValueOnce(existingGlobalChain)
        .mockReturnValueOnce(targetGlobalChain)
        .mockReturnValueOnce(globalUpdateChain)
        .mockReturnValueOnce(existingGlobalAfterOAuthChain);

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
      expect(globalUpdateChain.update).toHaveBeenCalledWith(
        expect.objectContaining({ claimed_by_user_id: 'user-123' }),
      );
      expect(globalUpdateChain.eq).toHaveBeenCalledWith('id', 'global-1');
      expect(globalUpdateChain.is).toHaveBeenCalledWith('claimed_by_user_id', null);
      expect(reply.send).toHaveBeenCalledWith({ next: '/' });
      expect(getUserMock).not.toHaveBeenCalled();
    });

    it('sets cookies for public personal-space OAuth without admin access', async () => {
      mockAuthUser({ id: 'user-123', email: 'fighter@example.com' });

      const reply = makeReply();
      await service.acceptOAuthSession(
        {
          accessToken: 'access-token',
          refreshToken: 'refresh-token',
          mode: 'public_login',
          next: '/me',
        },
        reply as never,
      );

      // Autolink runs even on public_login: it tries global_persons by
      // email and then checks already-claimed persons for a repairable
      // global_person_id. It must not claim new persons, platform roles,
      // or other admin-only tables.
      expect(fromMock).toHaveBeenCalledWith('global_persons');
      const otherTables = fromMock.mock.calls
        .map((call: unknown[]) => call[0] as string)
        .filter((name: string) => name !== 'global_persons' && name !== 'persons');
      expect(otherTables).toEqual([]);
      expect(reply.setCookie).toHaveBeenCalledWith(
        'sb-access-token',
        'access-token',
        expect.objectContaining({ httpOnly: true, maxAge: 2592000 }),
      );
      expect(reply.setCookie).toHaveBeenCalledWith(
        'sb-refresh-token',
        'refresh-token',
        expect.objectContaining({ httpOnly: true, maxAge: 2592000 }),
      );
      expect(reply.send).toHaveBeenCalledWith({ next: '/me' });
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
        expect.objectContaining({ httpOnly: true, maxAge: 2592000 }),
      );
      expect(reply.setCookie).toHaveBeenCalledWith(
        'sb-refresh-token',
        'password-refresh-token',
        expect.objectContaining({ httpOnly: true, maxAge: 2592000 }),
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
        .mockReturnValueOnce(makeQueryChain({ data: null, error: null })) // platform_roles
        .mockReturnValueOnce(makeQueryChain({ data: [], error: null })) // organization_members
        .mockReturnValueOnce(makeQueryChain({ data: [], error: null })); // league_user_roles

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

    it('allows password login for an account whose only grant is a direct league role', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          access_token: 'league-access-token',
          refresh_token: 'league-refresh-token',
          expires_in: 3600,
          user: { id: 'league-admin-1', email: 'league@example.com' },
        }),
      });
      fromMock
        .mockReturnValueOnce(makeQueryChain({ data: null, error: null })) // platform_roles
        .mockReturnValueOnce(makeQueryChain({ data: [], error: null })) // organization_members
        .mockReturnValueOnce(makeQueryChain({ data: [{ role: 'admin' }], error: null }));

      const reply = makeReply();
      await service.passwordLogin(
        { email: 'league@example.com', password: 'correct-password' },
        reply as never,
      );

      expect(reply.setCookie).toHaveBeenCalledWith(
        'sb-access-token',
        'league-access-token',
        expect.objectContaining({ httpOnly: true, maxAge: 2592000 }),
      );
      expect(reply.send).toHaveBeenCalledWith({ next: '/dashboard' });
    });

    // Regression guard. PostgREST nulls `data` and returns PGRST116 when
    // .maybeSingle() matches more than one row, and hasAdminAccess ignores
    // `error` — so reading organization_members with .maybeSingle() denied login
    // to every user who belongs to two or more organizations. Assert the query
    // shape, since the mock cannot reproduce PostgREST's multi-row behaviour.
    it('reads organization_members with limit(1) rather than maybeSingle', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          access_token: 'access-token',
          refresh_token: 'refresh-token',
          expires_in: 3600,
          user: { id: 'multi-org-user', email: 'owner@example.com' },
        }),
      });
      const orgChain = makeQueryChain({ data: [{ role: 'owner' }], error: null });
      fromMock
        .mockReturnValueOnce(makeQueryChain({ data: null, error: null }))
        .mockReturnValueOnce(orgChain);

      const reply = makeReply();
      await service.passwordLogin(
        { email: 'owner@example.com', password: 'correct-password' },
        reply as never,
      );

      expect(orgChain.limit).toHaveBeenCalledWith(1);
      expect(orgChain.maybeSingle).not.toHaveBeenCalled();
      expect(reply.send).toHaveBeenCalledWith({ next: '/dashboard' });
    });
  });

  describe('logout', () => {
    it('clears admin auth cookies and returns ok', () => {
      const reply = makeReply();

      const result = service.logout(reply as never);

      expect(result).toEqual({ ok: true });
      expect(reply.clearCookie).toHaveBeenCalledWith(
        'sb-access-token',
        expect.objectContaining({ path: '/', sameSite: 'lax' }),
      );
      expect(reply.clearCookie).toHaveBeenCalledWith(
        'sb-refresh-token',
        expect.objectContaining({ path: '/', sameSite: 'lax' }),
      );
      expect(reply.clearCookie).toHaveBeenCalledTimes(2);
    });
  });

  describe('cookie Domain scoping (production)', () => {
    // A separate AuthService wired with NODE_ENV=production + DOMAIN=myclash.fr so
    // cookieDomain() resolves to `.myclash.fr`. This locks in that the parent
    // domain actually reaches setCookie/clearCookie through the real auth flows —
    // the helper-level test only proves the helper honours a passed-in domain.
    function makeProdService(): AuthService {
      const prodConfig = {
        getOrThrow: (key: string) => {
          const values: Record<string, string> = {
            SUPABASE_URL: 'https://app.myclash.fr',
            SUPABASE_ANON_KEY: 'anon-key',
          };
          const value = values[key];
          if (!value) throw new Error(`Missing config ${key}`);
          return value;
        },
        get: (key: string, def?: string) => {
          const values: Record<string, string> = {
            NODE_ENV: 'production',
            DOMAIN: 'myclash.fr',
            SUPABASE_AUTH_INTERNAL_URL: 'http://supabase-auth:9999',
          };
          return values[key] ?? def ?? '';
        },
      };
      return new AuthService(
        mockSupabase as never,
        mockMailService as never,
        prodConfig as never,
        mockErasure as never,
        legalService,
        guestJwtService,
        mockOnboarding as never,
      );
    }

    it('sets refreshed cookies scoped to the parent domain', async () => {
      getAuthUserMock.mockImplementation(async (token: string) =>
        token === 'fresh-access' ? { id: 'u1', email: 'a@b.c', user_metadata: {} } : null,
      );
      refreshSessionMock.mockResolvedValue({
        access_token: 'fresh-access',
        refresh_token: 'fresh-refresh',
        expires_in: 3600,
      });

      const reply = makeReply();
      await makeProdService().getMe(
        { headers: {}, cookies: { 'sb-refresh-token': 'r' } } as never,
        reply as never,
      );

      expect(reply.setCookie).toHaveBeenCalledWith(
        'sb-access-token',
        'fresh-access',
        expect.objectContaining({ domain: '.myclash.fr', secure: true }),
      );
      expect(reply.setCookie).toHaveBeenCalledWith(
        'sb-refresh-token',
        'fresh-refresh',
        expect.objectContaining({ domain: '.myclash.fr', secure: true }),
      );
    });

    it('clears cookies with the parent domain on logout', () => {
      const reply = makeReply();
      makeProdService().logout(reply as never);

      expect(reply.clearCookie).toHaveBeenCalledWith(
        'sb-access-token',
        expect.objectContaining({ domain: '.myclash.fr' }),
      );
      expect(reply.clearCookie).toHaveBeenCalledWith(
        'sb-refresh-token',
        expect.objectContaining({ domain: '.myclash.fr' }),
      );
    });

    it('clears cookies with the parent domain on account deletion', async () => {
      // Google-only account (no email-password identity) → skips the password
      // re-auth and goes straight to deletion + cookie clear.
      getAuthUserMock.mockResolvedValue({ id: 'u1', email: 'a@b.c', identities: [] });

      const reply = makeReply();
      await makeProdService().deleteAccount(
        { headers: { authorization: 'Bearer t' }, cookies: {} } as never,
        '',
        'DELETE',
        reply as never,
      );

      expect(reply.clearCookie).toHaveBeenCalledWith(
        'sb-access-token',
        expect.objectContaining({ domain: '.myclash.fr' }),
      );
      expect(reply.clearCookie).toHaveBeenCalledWith(
        'sb-refresh-token',
        expect.objectContaining({ domain: '.myclash.fr' }),
      );
    });
  });

  describe('getPersonalSpace', () => {
    it('returns claimed profile data and empty-safe commitment arrays', async () => {
      mockAuthUser({
        id: 'user-123',
        email: 'fighter@example.com',
        user_metadata: { display_name: 'Fighter One' },
      });

      fromMock
        .mockReturnValueOnce(
          makeAwaitableQueryChain({
            data: [
              {
                id: 'person-1',
                event_id: 'event-1',
                given_name: 'Fighter',
                family_name: 'One',
              },
            ],
            error: null,
          }),
        )
        .mockReturnValueOnce(
          makeQueryChain({
            data: {
              id: 'global-1',
              display_name: 'Fighter One',
              is_fighter: true,
              is_referee: false,
              is_workshop_participant: true,
            },
            error: null,
          }),
        )
        .mockReturnValueOnce(makeAwaitableQueryChain({ data: [], error: null }))
        .mockReturnValueOnce(makeAwaitableQueryChain({ data: [], error: null }));

      const result = await service.getPersonalSpace({
        headers: { authorization: 'Bearer access-token' },
        cookies: {},
      } as never);

      expect(result.user.email).toBe('fighter@example.com');
      expect(result.profiles.globalPerson?.['id']).toBe('global-1');
      expect(result.profiles.claimedPersons).toHaveLength(1);
      expect(result.counts).toEqual({
        claimedPersons: 1,
        events: 1,
        refereeAssignments: 0,
        workshopEnrollments: 0,
      });
    });

    it('returns a safe empty state for signed-in users without linked profiles', async () => {
      mockAuthUser({ id: 'user-123', email: 'new@example.com' });

      fromMock
        .mockReturnValueOnce(makeAwaitableQueryChain({ data: [], error: null }))
        .mockReturnValueOnce(makeQueryChain({ data: null, error: null }))
        .mockReturnValueOnce(makeAwaitableQueryChain({ data: [], error: null }))
        .mockReturnValueOnce(makeAwaitableQueryChain({ data: [], error: null }));

      const result = await service.getPersonalSpace({
        headers: { authorization: 'Bearer access-token' },
        cookies: {},
      } as never);

      expect(result.profiles.globalPerson).toBeNull();
      expect(result.profiles.claimedPersons).toEqual([]);
      expect(result.counts.claimedPersons).toBe(0);
    });
  });

  describe('claimPersons', () => {
    it('claims roster profiles whose email matches and skips the rest', async () => {
      mockAuthUser({ id: 'user-1', email: 'fighter@example.com' });
      const okLookupChain = makeQueryChain({
        data: { id: 'ok', email: 'Fighter@example.com', claimed_by_user_id: null },
      });
      const okUpdateChain = makeQueryChain({ data: null });
      const okPersonChain = makeQueryChain({
        data: { global_person_id: 'global-ok' },
        error: null,
      });
      const existingGlobalChain = makeQueryChain({ data: null, error: null });
      const targetGlobalChain = makeQueryChain({
        data: { id: 'global-ok', claimed_by_user_id: null },
        error: null,
      });
      const globalUpdateChain = makeQueryChain({ data: null, error: null });
      fromMock
        .mockReturnValueOnce(okLookupChain)
        .mockReturnValueOnce(okUpdateChain)
        .mockReturnValueOnce(okPersonChain)
        .mockReturnValueOnce(existingGlobalChain)
        .mockReturnValueOnce(targetGlobalChain)
        .mockReturnValueOnce(globalUpdateChain)
        .mockReturnValueOnce(
          makeQueryChain({
            data: { id: 'bad', email: 'someone@else.com', claimed_by_user_id: null },
          }),
        );

      const result = await service.claimPersons(
        { headers: { authorization: 'Bearer t' }, cookies: {} } as never,
        ['ok', 'bad'],
      );

      expect(result.claimed).toBe(1);
      expect(globalUpdateChain.update).toHaveBeenCalledWith(
        expect.objectContaining({ claimed_by_user_id: 'user-1' }),
      );
      expect(globalUpdateChain.eq).toHaveBeenCalledWith('id', 'global-ok');
      expect(globalUpdateChain.is).toHaveBeenCalledWith('claimed_by_user_id', null);
    });

    it('never reassigns a profile already owned by another user', async () => {
      mockAuthUser({ id: 'user-1', email: 'fighter@example.com' });
      fromMock.mockReturnValueOnce(
        makeQueryChain({
          data: { id: 'p', email: 'fighter@example.com', claimed_by_user_id: 'someone-else' },
        }),
      );

      const result = await service.claimPersons(
        { headers: { authorization: 'Bearer t' }, cookies: {} } as never,
        ['p'],
      );

      expect(result.claimed).toBe(0);
    });
  });

  describe('tryAutolinkGlobalPerson', () => {
    it('repairs an existing claimed Person with exactly one unclaimed global profile', async () => {
      const existingGlobalChain = makeQueryChain({ data: null, error: null });
      const emailCandidatesChain = makeAwaitableQueryChain({ data: [], error: null });
      const claimedPersonsChain = makeAwaitableQueryChain({
        data: [{ global_person_id: 'global-1' }, { global_person_id: 'global-1' }],
        error: null,
      });
      const existingGlobalBeforeLinkChain = makeQueryChain({ data: null, error: null });
      const targetGlobalChain = makeQueryChain({
        data: { id: 'global-1', claimed_by_user_id: null },
        error: null,
      });
      const updateChain = makeQueryChain({ data: null, error: null });
      fromMock
        .mockReturnValueOnce(existingGlobalChain)
        .mockReturnValueOnce(emailCandidatesChain)
        .mockReturnValueOnce(claimedPersonsChain)
        .mockReturnValueOnce(existingGlobalBeforeLinkChain)
        .mockReturnValueOnce(targetGlobalChain)
        .mockReturnValueOnce(updateChain);

      await service.tryAutolinkGlobalPerson('user-1', 'fighter@example.com');

      expect(updateChain.update).toHaveBeenCalledWith(
        expect.objectContaining({ claimed_by_user_id: 'user-1' }),
      );
      expect(updateChain.eq).toHaveBeenCalledWith('id', 'global-1');
      expect(updateChain.is).toHaveBeenCalledWith('claimed_by_user_id', null);
    });

    it('does not repair when claimed Persons point at multiple global profiles', async () => {
      const existingGlobalChain = makeQueryChain({ data: null, error: null });
      const emailCandidatesChain = makeAwaitableQueryChain({ data: [], error: null });
      const claimedPersonsChain = makeAwaitableQueryChain({
        data: [{ global_person_id: 'global-1' }, { global_person_id: 'global-2' }],
        error: null,
      });
      fromMock
        .mockReturnValueOnce(existingGlobalChain)
        .mockReturnValueOnce(emailCandidatesChain)
        .mockReturnValueOnce(claimedPersonsChain);

      await service.tryAutolinkGlobalPerson('user-1', 'fighter@example.com');

      expect(fromMock).toHaveBeenCalledTimes(3);
    });

    it('does not repair when the target global profile is owned by another user', async () => {
      const existingGlobalChain = makeQueryChain({ data: null, error: null });
      const emailCandidatesChain = makeAwaitableQueryChain({ data: [], error: null });
      const claimedPersonsChain = makeAwaitableQueryChain({
        data: [{ global_person_id: 'global-1' }],
        error: null,
      });
      const existingGlobalBeforeLinkChain = makeQueryChain({ data: null, error: null });
      const targetGlobalChain = makeQueryChain({
        data: { id: 'global-1', claimed_by_user_id: 'other-user' },
        error: null,
      });
      fromMock
        .mockReturnValueOnce(existingGlobalChain)
        .mockReturnValueOnce(emailCandidatesChain)
        .mockReturnValueOnce(claimedPersonsChain)
        .mockReturnValueOnce(existingGlobalBeforeLinkChain)
        .mockReturnValueOnce(targetGlobalChain);

      await service.tryAutolinkGlobalPerson('user-1', 'fighter@example.com');

      expect(fromMock).toHaveBeenCalledTimes(5);
    });

    it('flips linked persons to claimed when autolinking by email match', async () => {
      const existingGlobalChain = makeQueryChain({ data: null, error: null });
      const emailCandidatesChain = makeAwaitableQueryChain({
        data: [{ id: 'global-1' }],
        error: null,
      });
      const globalUpdateChain = makeQueryChain({ data: null, error: null });
      const personsSyncChain = makeQueryChain({ data: null, error: null });
      fromMock
        .mockReturnValueOnce(existingGlobalChain)
        .mockReturnValueOnce(emailCandidatesChain)
        .mockReturnValueOnce(globalUpdateChain)
        .mockReturnValueOnce(personsSyncChain);

      await service.tryAutolinkGlobalPerson('user-1', 'fighter@example.com');

      expect(globalUpdateChain.update).toHaveBeenCalledWith(
        expect.objectContaining({ claimed_by_user_id: 'user-1' }),
      );
      expect(personsSyncChain.update).toHaveBeenCalledWith({
        claim_status: 'claimed',
        claimed_by_user_id: 'user-1',
      });
      expect(personsSyncChain.eq).toHaveBeenCalledWith('global_person_id', 'global-1');
      expect(personsSyncChain.is).toHaveBeenCalledWith('claimed_by_user_id', null);
    });
  });

  describe('confirmGlobalPersonClaim', () => {
    it('flips linked persons to claimed on magic-link claim confirmation', async () => {
      mockAuthUser({ id: 'user-1', email: 'fighter@example.com' });
      const future = new Date(Date.now() + 3_600_000).toISOString();
      const tokenLoadChain = makeQueryChain({
        data: {
          id: 'token-row-1',
          user_id: 'user-1',
          global_person_id: 'global-1',
          expires_at: future,
        },
        error: null,
      });
      const globalUpdateChain = makeQueryChain({ data: { id: 'global-1' }, error: null });
      const tokenDeleteChain = { delete: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis() };
      const personsSyncChain = makeQueryChain({ data: null, error: null });
      fromMock
        .mockReturnValueOnce(tokenLoadChain)
        .mockReturnValueOnce(globalUpdateChain)
        .mockReturnValueOnce(tokenDeleteChain)
        .mockReturnValueOnce(personsSyncChain);

      const result = await service.confirmGlobalPersonClaim(
        { headers: { authorization: 'Bearer t' }, cookies: {} } as never,
        'claim-token',
      );

      expect(result).toEqual({ status: 'claimed', globalPersonId: 'global-1' });
      expect(personsSyncChain.update).toHaveBeenCalledWith({
        claim_status: 'claimed',
        claimed_by_user_id: 'user-1',
      });
      expect(personsSyncChain.eq).toHaveBeenCalledWith('global_person_id', 'global-1');
      expect(personsSyncChain.is).toHaveBeenCalledWith('claimed_by_user_id', null);
    });

    it('looks the token up by hash, never by the raw value', async () => {
      mockAuthUser({ id: 'user-1', email: 'fighter@example.com' });
      const future = new Date(Date.now() + 3_600_000).toISOString();
      const tokenLoadChain = makeQueryChain({
        data: {
          id: 'token-row-1',
          user_id: 'user-1',
          global_person_id: 'global-1',
          expires_at: future,
        },
        error: null,
      });
      const tokenDeleteChain = { delete: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis() };
      fromMock
        .mockReturnValueOnce(tokenLoadChain)
        .mockReturnValueOnce(makeQueryChain({ data: { id: 'global-1' }, error: null }))
        .mockReturnValueOnce(tokenDeleteChain)
        .mockReturnValueOnce(makeQueryChain({ data: null, error: null }));

      await service.confirmGlobalPersonClaim(
        { headers: { authorization: 'Bearer t' }, cookies: {} } as never,
        'raw-claim-token',
      );

      expect(tokenLoadChain.eq).toHaveBeenCalledWith(
        'token_hash',
        createHash('sha256').update('raw-claim-token').digest('hex'),
      );
      // The raw token must never reach the database, under any column.
      for (const [column, value] of tokenLoadChain.eq.mock.calls) {
        expect(column).not.toBe('token');
        expect(value).not.toBe('raw-claim-token');
      }
      // Single-use delete keys on the surrogate id, not the secret.
      expect(tokenDeleteChain.eq).toHaveBeenCalledWith('id', 'token-row-1');
    });
  });

  describe('requestGlobalPersonClaim', () => {
    it('stores only the hash and mails the raw token', async () => {
      mockAuthUser({ id: 'user-1', email: 'fighter@example.com' });
      const personLoadChain = makeQueryChain({
        data: {
          id: 'global-1',
          email: 'fighter@example.com',
          display_name: 'Fighter One',
          merged_into_id: null,
          claimed_by_user_id: null,
        },
        error: null,
      });
      const tokenInsertChain = {
        insert: vi.fn().mockResolvedValue({ error: null }),
      };
      fromMock.mockReturnValueOnce(personLoadChain).mockReturnValueOnce(tokenInsertChain);

      const result = await service.requestGlobalPersonClaim(
        { headers: { authorization: 'Bearer t' }, cookies: {} } as never,
        'global-1',
      );

      expect(result).toMatchObject({ status: 'confirmation_sent' });

      const inserted = tokenInsertChain.insert.mock.calls[0]?.[0] as Record<string, unknown>;
      const magicLink = mockMailService.sendMagicLink.mock.calls[0]?.[0]?.magicLink as string;
      const rawToken = new URL(magicLink).searchParams.get('token') ?? '';

      // The row carries a digest, and no column carries the raw secret.
      expect(inserted['token']).toBeUndefined();
      expect(rawToken).not.toBe('');
      expect(Object.values(inserted)).not.toContain(rawToken);
      expect(inserted['token_hash']).toBe(createHash('sha256').update(rawToken).digest('hex'));
      // sha256 hex, so the emailed value is not recoverable from the row.
      expect(inserted['token_hash']).toMatch(/^[0-9a-f]{64}$/u);
      // Raw token stays within the confirm DTO's 20..64 bound.
      expect(rawToken.length).toBeGreaterThanOrEqual(20);
      expect(rawToken.length).toBeLessThanOrEqual(64);
    });
  });
});
