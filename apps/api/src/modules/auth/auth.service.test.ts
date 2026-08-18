import { createHash } from 'node:crypto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  BadRequestException,
  ForbiddenException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { LegalAcceptanceService } from '../privacy/legal-acceptance.service';
import { AuthService } from './auth.service';
import { GuestJwtService } from './guest-jwt.service';
import {
  filtersFor,
  mockSupabase as seededSupabase,
  queriedTables,
  scopedTo,
  writesTo,
  type RecordedWrite,
  type SupabaseRow,
  type TableSeed,
} from '../../common/testing/supabase-chain';

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

/**
 * Routes `from()` by TABLE, for the describes that have been migrated off the
 * ordered `mockReturnValueOnce` queue the rest of this file still uses.
 *
 * The queue is position-dependent: insert a query anywhere upstream and every
 * later answer shifts by one while the suite stays green. Routing by table also
 * lets a fixture NARROW, which is what turns the `.eq()` calls in the service
 * from things a test can only assert were asked into things that decide its
 * result.
 */
function seedTables(byTable: Record<string, TableSeed>) {
  const seeded = seededSupabase(byTable);
  fromMock.mockImplementation(seeded.from as never);
  return seeded;
}

/** The `is('col', null)` scope on a recorded write, which `scopedTo` cannot see. */
const isNullScoped = (write: RecordedWrite | undefined, column: string): boolean =>
  (write?.filters ?? []).some(
    (filter) => filter.method === 'is' && filter.args[0] === column && filter.args[1] === null,
  );

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

  describe('publicPasswordReset', () => {
    /**
     * The link opens the host that asked. This used to be hardcoded to the
     * participant app for everyone, so an organizer who pressed "forgot
     * password" on admin.${DOMAIN} was mailed a link to a domain they had not
     * asked about — which is what phishing looks like.
     */
    it('sends an organizer back to the admin host', async () => {
      generateLinkMock.mockResolvedValue({
        data: { properties: { action_link: 'https://example.com/recover' } },
        error: null,
      });

      await service.publicPasswordReset('organizer@example.com', 'login');

      expect(generateLinkMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'recovery',
          options: { redirectTo: 'https://admin.myclash.localhost/reset-password' },
        }),
      );
    });

    it('defaults to the participant host when no audience is given', async () => {
      generateLinkMock.mockResolvedValue({
        data: { properties: { action_link: 'https://example.com/recover' } },
        error: null,
      });

      await service.publicPasswordReset('fighter@example.com');

      expect(generateLinkMock).toHaveBeenCalledWith(
        expect.objectContaining({
          options: { redirectTo: 'https://app.myclash.localhost/reset-password' },
        }),
      );
    });

    it('mails it as a recovery, not as a login link', async () => {
      generateLinkMock.mockResolvedValue({
        data: { properties: { action_link: 'https://example.com/recover' } },
        error: null,
      });

      await service.publicPasswordReset('organizer@example.com', 'login');

      // 'login' here would send "Your MyClash login link" with a "Log in"
      // button to someone who asked to reset a password.
      expect(mockMailService.sendMagicLink).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'organizer@example.com', type: 'recovery' }),
      );
    });

    it('answers the same way for an address that does not exist', async () => {
      generateLinkMock.mockResolvedValue({
        data: { properties: {} },
        error: { message: 'User not found' },
      });

      const result = await service.publicPasswordReset('unknown@example.com', 'login');

      expect(result.message).toContain('If this email is registered');
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

  /**
   * `/me` — read on every page load, by claimed users, guests and nobody.
   *
   * The claimed branch alone touches five tables: the caller's roster profile,
   * their platform tier, their workspaces, their avatar and their league
   * grants. Every one of those reads sits inside a `catch` that falls back to
   * empty, so a fixture that cannot serve a query produces a plausible-looking
   * signed-in response rather than a failure.
   *
   * The old fixtures answered by CALL ORDER, and three separate comments in
   * `buildClaimedResponse` record what that cost: each says a query is "kept
   * last" or "appended LAST" because "inserting a query earlier silently hands
   * every later one the wrong response". The test fixture was dictating where
   * production queries were allowed to go. Routing by table removes that.
   *
   * Every table below carries a row belonging to ANOTHER account, so a lost
   * scope does not return nothing — it returns somebody else's profile, tier,
   * workspace list, avatar or league grant.
   */
  describe('getMe', () => {
    const USER = 'user-123';

    const GUEST_PERSON = {
      id: 'person-1',
      given_name: 'Jean',
      family_name: 'Dupont',
      event_id: 'event-1',
      claim_status: 'unclaimed',
    };

    const OTHER = 'other-user';
    const soon = () => new Date(Date.now() + 3_600_000).toISOString();

    /** One row per table, all belonging to a DIFFERENT account. */
    const DECOY_PERSON = {
      id: 'person-other',
      claimed_by_user_id: OTHER,
      given_name: 'Someone',
      family_name: 'Else',
      event_id: 'event-9',
      claim_status: 'claimed',
    };
    const DECOY_MEMBERSHIP = {
      user_id: OTHER,
      role: 'owner',
      organizations: { id: 'org-9', slug: 'not-mine', name: 'Not Mine' },
    };
    const DECOY_GLOBAL = {
      id: 'global-other',
      claimed_by_user_id: OTHER,
      photo_url: 'https://cdn.example/not-me.jpg',
    };
    const GUEST_SESSIONS = [
      // Revoked, and seeded first: a lost id scope reads as a revoked session,
      // which the service reports as anonymous.
      {
        id: 'session-other',
        device_label: 'Another tablet',
        expires_at: soon(),
        revoked_at: new Date().toISOString(),
      },
      { id: 'session-1', device_label: 'iPhone (Safari)', expires_at: soon(), revoked_at: null },
    ];

    interface MineSeed {
      person?: SupabaseRow;
      platformRole?: string;
      memberships?: SupabaseRow[];
      photoUrl?: string;
      leagueRole?: string;
    }

    function seedMe(mine: MineSeed = {}) {
      return seedTables({
        persons: { rows: [DECOY_PERSON, GUEST_PERSON, ...(mine.person ? [mine.person] : [])] },
        platform_roles: {
          rows: [
            { user_id: OTHER, role: 'super_admin' },
            ...(mine.platformRole ? [{ user_id: USER, role: mine.platformRole }] : []),
          ],
        },
        organization_members: { rows: [DECOY_MEMBERSHIP, ...(mine.memberships ?? [])] },
        global_persons: {
          rows: [
            DECOY_GLOBAL,
            ...(mine.photoUrl
              ? [{ id: 'global-1', claimed_by_user_id: USER, photo_url: mine.photoUrl }]
              : []),
          ],
        },
        league_user_roles: {
          rows: [
            { user_id: OTHER, role: 'admin' },
            // This account holds a league role that is NOT admin or owner, so
            // the role filter is what keeps "My leagues" out of their nav.
            { user_id: USER, role: 'viewer' },
            ...(mine.leagueRole ? [{ user_id: USER, role: mine.leagueRole }] : []),
          ],
        },
        guest_sessions: { rows: GUEST_SESSIONS },
      });
    }

    beforeEach(() => {
      seedMe();
    });

    const claimedRequest = (token = 'valid-token') =>
      ({ headers: { authorization: `Bearer ${token}` }, cookies: {} }) as never;

    const guestCookie = () =>
      guestJwtService.sign(
        { sub: 'session-1', person_id: 'person-1', event_id: 'event-1', type: 'guest' },
        new Date(Date.now() + 3_600_000),
      );

    it('returns anonymous when no token present', async () => {
      const result = await service.getMe({ headers: {}, cookies: {} } as never);
      expect(result.type).toBe('anonymous');
    });

    it('returns claimed when valid Supabase token present', async () => {
      mockAuthUser({
        id: USER,
        email: 'organizer@example.com',
        user_metadata: { display_name: 'Jean Dupont' },
      });

      const result = await service.getMe(claimedRequest());

      expect(fetchMock).toHaveBeenCalledWith(
        'http://supabase-auth:9999/user',
        expect.objectContaining({
          method: 'GET',
          headers: { apikey: 'anon-key', Authorization: 'Bearer valid-token' },
        }),
      );
      expect(getUserMock).not.toHaveBeenCalled();
      expect(result.type).toBe('claimed');
      expect(result.user?.email).toBe('organizer@example.com');
      // Nothing seeded belongs to this account, so every admin axis is empty —
      // and none of the other account's rows leaked into it.
      expect(result.admin).toEqual({
        platformRole: null,
        organizations: [],
        hasLeagueRoles: false,
      });
      expect(result.user?.photo_url).toBeUndefined();
      expect(result.person).toBeUndefined();
    });

    it('returns the caller own roster profile, not another account one', async () => {
      mockAuthUser({ id: USER, email: 'fighter@example.com', user_metadata: {} });
      seedMe({
        person: {
          id: 'person-mine',
          claimed_by_user_id: USER,
          given_name: 'Fighter',
          family_name: 'One',
          event_id: 'event-1',
          claim_status: 'claimed',
        },
      });

      const result = await service.getMe(claimedRequest());

      expect(result.person?.id).toBe('person-mine');
      expect(result.person?.given_name).toBe('Fighter');
    });

    it('includes the claimed user global profile photo when linked', async () => {
      mockAuthUser({
        id: USER,
        email: 'fighter@example.com',
        user_metadata: { display_name: 'Fighter One' },
      });
      seedMe({ photoUrl: 'https://cdn.example/avatar.jpg' });

      const result = await service.getMe(claimedRequest());

      expect(result.type).toBe('claimed');
      expect(result.user?.photo_url).toBe('https://cdn.example/avatar.jpg');
    });

    it('returns super-admin landing context for platform admins', async () => {
      mockAuthUser({
        id: USER,
        email: 'admin@example.com',
        user_metadata: { display_name: 'Super Admin' },
      });
      seedMe({ platformRole: 'super_admin' });

      const result = await service.getMe(claimedRequest('admin-token'));

      expect(result.type).toBe('claimed');
      expect(result.admin).toEqual({
        platformRole: 'super_admin',
        organizations: [],
        hasLeagueRoles: false,
      });
    });

    // The tier is reported verbatim, not collapsed to a boolean. This is what
    // lets the console gate its nav per tier instead of all-or-nothing.
    it.each(['platform_admin', 'platform_viewer'])('reports the %s tier verbatim', async (role) => {
      mockAuthUser({ id: USER, email: `${role}@example.com` });
      seedMe({ platformRole: role });

      const result = await service.getMe(claimedRequest());

      expect(result.admin).toEqual({
        platformRole: role,
        organizations: [],
        hasLeagueRoles: false,
      });
    });

    it('returns organization landing context for organizer users', async () => {
      mockAuthUser({ id: USER, email: 'organizer@example.com', user_metadata: {} });
      seedMe({
        memberships: [
          {
            user_id: USER,
            role: 'owner',
            organizations: { id: 'org-1', slug: 'lyon-amhe', name: 'Lyon AMHE' },
          },
          {
            user_id: USER,
            role: 'admin',
            organizations: [{ id: 'org-2', slug: 'paris-hema', name: 'Paris HEMA' }],
          },
        ],
      });

      const result = await service.getMe(claimedRequest('organizer-token'));

      expect(result.type).toBe('claimed');
      // `name` rides along for the sidebar workspace switcher, which lists a
      // multi-org account's workspaces by name. Both embed shapes are covered
      // above on purpose: PostgREST returns an object for a to-one embed and an
      // array when it can't prove the relationship is unique.
      expect(result.admin).toEqual({
        platformRole: null,
        organizations: [
          { id: 'org-1', slug: 'lyon-amhe', name: 'Lyon AMHE', role: 'owner' },
          { id: 'org-2', slug: 'paris-hema', name: 'Paris HEMA', role: 'admin' },
        ],
        hasLeagueRoles: false,
      });
    });

    // The normalizer drops a membership row whose org projection is incomplete
    // rather than emitting a workspace entry with an undefined name — an
    // unnamed row in the switcher menu is unpickable.
    it('drops a membership row whose organization has no name', async () => {
      mockAuthUser({
        id: USER,
        email: 'organizer@example.com',
        user_metadata: { display_name: 'Org Admin' },
      });
      seedMe({
        memberships: [
          { user_id: USER, role: 'owner', organizations: { id: 'org-1', slug: 'lyon-amhe' } },
          {
            user_id: USER,
            role: 'admin',
            organizations: { id: 'org-2', slug: 'paris-hema', name: 'Paris HEMA' },
          },
        ],
      });

      const result = await service.getMe(claimedRequest('organizer-token'));

      expect(result.admin?.organizations).toEqual([
        { id: 'org-2', slug: 'paris-hema', name: 'Paris HEMA', role: 'admin' },
      ]);
    });

    // Drives the "My leagues" nav entry and the /dashboard league branch, so it
    // must be true for an account holding only a personal league grant.
    it('reports hasLeagueRoles for an account with a direct league grant', async () => {
      mockAuthUser({ id: USER, email: 'league@example.com', user_metadata: {} });
      seedMe({ leagueRole: 'admin' });

      const result = await service.getMe(claimedRequest('league-token'));

      expect(result.admin).toEqual({
        platformRole: null,
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

      const result = await service.getMe(claimedRequest('bad-token'));

      expect(result.type).toBe('anonymous');
      expect(getUserMock).not.toHaveBeenCalled();
    });

    it('returns guest when valid mc_guest cookie present (no Supabase token)', async () => {
      const result = await service.getMe({
        headers: {},
        cookies: { mc_guest: guestCookie() },
      } as never);

      expect(result.type).toBe('guest');
      expect(result.session?.device_label).toBe('iPhone (Safari)');
      expect(result.person?.given_name).toBe('Jean');
      expect(fetchMock).not.toHaveBeenCalled();
      expect(getUserMock).not.toHaveBeenCalled();
    });

    it('claimed wins when both Supabase token and guest cookie present; clears guest cookie', async () => {
      mockAuthUser({ id: USER, email: 'organizer@example.com', user_metadata: {} });
      const clearCookieMock = vi.fn();

      const result = await service.getMe(
        {
          headers: { authorization: 'Bearer valid-token' },
          cookies: { mc_guest: guestCookie() },
        } as never,
        { clearCookie: clearCookieMock } as never,
      );

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

  /**
   * The login gate: who gets a session cookie at all.
   *
   * `hasAdminAccess` walks three tables in turn — platform tier, then org
   * membership, then a direct league grant — and `assertNotLockedOut` reads a
   * fourth before any of it becomes a cookie. Each read is scoped to the
   * caller, and each sits where losing that scope hands the session to somebody
   * else's credential rather than to nobody.
   *
   * So every table carries a STRANGER's row: an unrelated super admin, an
   * unrelated org owner, an unrelated league admin, a feature flag that is not
   * the lockdown one. The flag decoy is seeded FIRST because `maybeSingle` on a
   * seeded table takes row zero — a decoy behind the wanted row can never be
   * returned and would guard nothing.
   *
   * `tryAutolinkGlobalPerson` runs after every successful login, so
   * global_persons and persons are declared too. A fixture that leaves a table
   * out throws rather than silently skipping the step it belongs to.
   */
  const STRANGER = 'stranger-9';
  const OTHER_FLAG = { key: 'maintenance_banner', enabled: true };

  function seedLogin(over: Record<string, SupabaseRow[]> = {}) {
    const base: Record<string, SupabaseRow[]> = {
      platform_roles: [{ user_id: STRANGER, role: 'super_admin' }],
      organization_members: [{ user_id: STRANGER, role: 'owner' }],
      league_user_roles: [{ user_id: STRANGER, role: 'admin' }],
      feature_flags: [OTHER_FLAG, { key: 'admin_lockdown', enabled: false }],
      global_persons: [],
      persons: [],
    };
    return seedTables(
      Object.fromEntries(
        Object.entries({ ...base, ...over }).map(([table, rows]) => [table, { rows }]),
      ),
    );
  }

  describe('acceptOAuthSession', () => {
    it('sets cookies for an existing organizer member', async () => {
      mockAuthUser({ id: 'user-123', email: 'org@example.com' });
      seedLogin({
        organization_members: [
          { user_id: STRANGER, role: 'owner' },
          { user_id: 'user-123', role: 'editor' },
        ],
      });

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

    // `read_only` is the one organization role the login gate leaves out of its
    // list, and the stranger holds every credential the gate accepts. So this
    // refusal fails in three different ways if any of the three reads stops
    // being scoped to the caller: it admits an outsider's org, an outsider's
    // league grant, or the caller's own read-only seat.
    it('refuses a read-only member holding none of a stranger’s grants', async () => {
      mockAuthUser({ id: 'user-123', email: 'outsider@example.com' });
      seedLogin({
        organization_members: [
          { user_id: STRANGER, role: 'owner' },
          { user_id: 'user-123', role: 'read_only' },
        ],
      });

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

    /**
     * Lockdown is checked at LOGIN, not only by the interceptor: an organizer
     * is refused a cookie outright while it is on, and platform staff of any
     * tier still get one so somebody can turn it back off. Nothing tested
     * either half — `assertNotLockedOut` had no test at all.
     */
    it('refuses an organizer while admin lockdown is on, but not platform staff', async () => {
      const flags = [OTHER_FLAG, { key: 'admin_lockdown', enabled: true }];
      const session = {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        mode: 'admin_login' as const,
      };

      mockAuthUser({ id: 'user-123', email: 'org@example.com' });
      seedLogin({
        feature_flags: flags,
        organization_members: [{ user_id: 'user-123', role: 'owner' }],
      });
      await expect(service.acceptOAuthSession(session, makeReply() as never)).rejects.toThrow(
        ServiceUnavailableException,
      );

      mockAuthUser({ id: 'staff-1', email: 'staff@example.com' });
      seedLogin({
        feature_flags: flags,
        platform_roles: [
          { user_id: STRANGER, role: 'super_admin' },
          { user_id: 'staff-1', role: 'platform_viewer' },
        ],
      });
      const reply = makeReply();
      await service.acceptOAuthSession(session, reply as never);
      expect(reply.send).toHaveBeenCalledWith({ next: '/dashboard' });
    });

    // The lower platform tiers exist ONLY as platform_roles rows — no org, no
    // league grant. If this login gate stayed super-admin-exact they could not
    // reach the console at all and the whole feature would be invisible.
    it.each(['platform_admin', 'platform_viewer'])(
      'sets cookies for a %s whose only grant is the platform role',
      async (role) => {
        mockAuthUser({ id: `${role}-1`, email: `${role}@example.com` });
        seedLogin({
          platform_roles: [
            { user_id: STRANGER, role: 'super_admin' },
            { user_id: `${role}-1`, role },
          ],
        });

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
      seedLogin({
        league_user_roles: [
          { user_id: STRANGER, role: 'admin' },
          { user_id: 'league-admin-1', role: 'owner' },
        ],
      });

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
      seedLogin();
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

    // A neighbour is seeded FIRST on both tables, with an email the caller does
    // not own and a global profile that is not theirs. `validatePersonClaim`
    // reads with maybeSingle, so an unscoped read returns the neighbour and the
    // claim is refused for the wrong reason — which is the shape of the bug
    // where a claim lands on somebody else's roster row.
    const CLAIMED_PERSON = '00000000-0000-0000-0000-000000000001';
    const NEIGHBOUR = {
      id: '00000000-0000-0000-0000-0000000000ff',
      email: 'someone.else@example.com',
      claim_status: 'unclaimed',
      global_person_id: 'global-99',
    };

    it('claims a Person when Google email matches the registered email', async () => {
      mockAuthUser({ id: 'user-123', email: 'jean@example.com' });
      const seeded = seedLogin({
        persons: [
          NEIGHBOUR,
          {
            id: CLAIMED_PERSON,
            email: 'jean@example.com',
            claim_status: 'unclaimed',
            global_person_id: 'global-1',
          },
        ],
        global_persons: [
          { id: 'global-99', email: 'nobody@example.com', claimed_by_user_id: STRANGER },
          // A different email, so the autolink that follows every login finds
          // no candidate of its own and this test stays about the claim.
          { id: 'global-1', email: 'jean.old@example.com', claimed_by_user_id: null },
        ],
        fighter_clubs: [],
      });

      const reply = makeReply();
      await service.acceptOAuthSession(
        {
          accessToken: 'access-token',
          refreshToken: 'refresh-token',
          mode: 'person_claim',
          personId: CLAIMED_PERSON,
        },
        reply as never,
      );

      const [claim] = writesTo(seeded, 'persons');
      expect(claim?.row).toEqual({ claim_status: 'claimed', claimed_by_user_id: 'user-123' });
      expect(scopedTo(claim, 'id')).toBe(CLAIMED_PERSON);

      const [link] = writesTo(seeded, 'global_persons');
      expect(link?.row).toEqual(expect.objectContaining({ claimed_by_user_id: 'user-123' }));
      expect(scopedTo(link, 'id')).toBe('global-1');
      expect(isNullScoped(link, 'claimed_by_user_id')).toBe(true);
      expect(reply.send).toHaveBeenCalledWith({ next: '/' });
      expect(getUserMock).not.toHaveBeenCalled();
    });

    it('sets cookies for public personal-space OAuth without admin access', async () => {
      mockAuthUser({ id: 'user-123', email: 'fighter@example.com' });
      const seeded = seedLogin();

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
      const asked = new Set(queriedTables(seeded.from));
      expect(asked).toEqual(new Set(['global_persons', 'persons']));
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
      const seeded = seedLogin({
        persons: [
          NEIGHBOUR,
          { id: CLAIMED_PERSON, email: 'jean@example.com', claim_status: 'unclaimed' },
        ],
      });

      await expect(
        service.acceptOAuthSession(
          {
            accessToken: 'access-token',
            refreshToken: 'refresh-token',
            mode: 'person_claim',
            personId: CLAIMED_PERSON,
          },
          makeReply() as never,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(writesTo(seeded, 'persons')).toEqual([]);
      expect(getUserMock).not.toHaveBeenCalled();
    });

    it('rejects OAuth when internal GoTrue rejects the access token', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        json: vi.fn().mockResolvedValue({ error: 'invalid_token' }),
      });
      const seeded = seedLogin();

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
      expect(queriedTables(seeded.from)).toEqual([]);
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
      seedLogin({
        platform_roles: [
          { user_id: STRANGER, role: 'super_admin' },
          { user_id: 'admin-123', role: 'super_admin' },
        ],
      });

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
      const seeded = seedLogin();

      await expect(
        service.passwordLogin(
          {
            email: 'admin@example.com',
            password: 'wrong-password',
          },
          makeReply() as never,
        ),
      ).rejects.toThrow(UnauthorizedException);
      expect(queriedTables(seeded.from)).toEqual([]);
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
      seedLogin({
        organization_members: [
          { user_id: STRANGER, role: 'owner' },
          { user_id: 'user-123', role: 'read_only' },
        ],
      });

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
      seedLogin({
        league_user_roles: [
          { user_id: STRANGER, role: 'admin' },
          { user_id: 'league-admin-1', role: 'owner' },
        ],
      });

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
    // to every user who belongs to two or more organizations. Still an argument
    // assertion after the migration: the seeded double's maybeSingle returns row
    // zero rather than raising PGRST116, so it cannot reproduce the failure and
    // the two memberships below would log in either way.
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
      const seeded = seedLogin({
        organization_members: [
          { user_id: 'multi-org-user', role: 'owner', organization_id: 'org-a' },
          { user_id: 'multi-org-user', role: 'editor', organization_id: 'org-b' },
        ],
      });

      const reply = makeReply();
      await service.passwordLogin(
        { email: 'owner@example.com', password: 'correct-password' },
        reply as never,
      );

      expect(filtersFor(seeded.from, 'organization_members', 'limit')).toEqual([[1]]);
      expect(filtersFor(seeded.from, 'organization_members', 'maybeSingle')).toEqual([]);
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

  /**
   * The /me dashboard. Five reads run in one `Promise.all`, and every one of
   * them ends in `if (error) return []` inside a `catch` that also returns
   * `[]` — so a fixture that cannot serve a query does not fail the test, it
   * silently produces an empty dashboard.
   *
   * Seeding all four tables is what makes the scoping decide the answer: every
   * table carries a row belonging to somebody else, so a lost filter shows the
   * signed-in user another person's profiles, duties or suggestions.
   */
  describe('getPersonalSpace', () => {
    const USER = 'user-123';
    const EMAIL = 'fighter@example.com';

    const person = (over: Record<string, unknown> = {}) => ({
      id: 'p-1',
      event_id: 'event-1',
      given_name: 'Fighter',
      family_name: 'One',
      email: EMAIL,
      claimed_by_user_id: USER,
      claim_status: 'claimed',
      global_person_id: 'global-1',
      events: { id: 'event-1', name: 'FAL 2026' },
      ...over,
    });

    const populated = () =>
      seedTables({
        persons: {
          rows: [
            person({ id: 'p-other-user', claimed_by_user_id: 'other-user', event_id: 'event-9' }),
            // Same email, but already claimed — suggesting it would be wrong.
            person({ id: 'p-taken', claimed_by_user_id: 'someone-else', event_id: 'event-8' }),
            person(),
            person({ id: 'p-claimable', claimed_by_user_id: null, event_id: 'event-2' }),
          ],
        },
        global_persons: {
          rows: [
            { id: 'global-other', claimed_by_user_id: 'other-user', display_name: 'Someone Else' },
            { id: 'global-1', claimed_by_user_id: USER, display_name: 'Fighter One' },
          ],
        },
        referee_assignments: {
          rows: [
            { id: 'ra-other-1', person_id: 'global-other', created_at: '2026-01-01T00:00:00Z' },
            { id: 'ra-other-2', person_id: 'global-other', created_at: '2026-01-02T00:00:00Z' },
            { id: 'ra-1', person_id: 'global-1', created_at: '2026-02-01T00:00:00Z' },
          ],
        },
        workshop_enrollments: {
          rows: [
            { id: 'we-other', user_id: 'other-user', enrolled_at: '2026-01-01T00:00:00Z' },
            { id: 'we-1', user_id: USER, enrolled_at: '2026-02-01T00:00:00Z' },
          ],
        },
      });

    const read = () =>
      service.getPersonalSpace({
        headers: { authorization: 'Bearer access-token' },
        cookies: {},
      } as never);

    it('shows only this user’s profiles, duties and suggestions', async () => {
      mockAuthUser({ id: USER, email: EMAIL, user_metadata: { display_name: 'Fighter One' } });
      populated();

      const result = await read();

      expect(result.user.email).toBe(EMAIL);
      expect(result.profiles.globalPerson?.['id']).toBe('global-1');
      expect(result.profiles.claimedPersons.map((p) => p['id'])).toEqual(['p-1']);
      expect(result.counts).toEqual({
        claimedPersons: 1,
        events: 1,
        refereeAssignments: 1,
        workshopEnrollments: 1,
      });
      // The referee read resolves the user to a global person FIRST; resolving
      // the wrong one hands them another referee's duty list.
      expect(result.commitments.refereeAssignments.map((a) => a['id'])).toEqual(['ra-1']);
      expect(result.commitments.workshopEnrollments.map((w) => w['id'])).toEqual(['we-1']);
      // An unclaimed roster row on the same email is a suggestion; one already
      // claimed by somebody else is not.
      expect(result.claimable.map((c) => c.id)).toEqual(['p-claimable']);
    });

    it('returns a safe empty state for signed-in users without linked profiles', async () => {
      // A different account entirely: same seeded tables, nothing of theirs.
      mockAuthUser({ id: 'user-new', email: 'new@example.com' });
      populated();

      const result = await read();

      expect(result.profiles.globalPerson).toBeNull();
      expect(result.profiles.claimedPersons).toEqual([]);
      expect(result.claimable).toEqual([]);
      expect(result.counts).toEqual({
        claimedPersons: 0,
        events: 0,
        refereeAssignments: 0,
        workshopEnrollments: 0,
      });
    });
  });

  describe('claimPersons', () => {
    const USER = 'user-1';
    const EMAIL = 'fighter@example.com';

    const claim = (ids: string[]) =>
      service.claimPersons({ headers: { authorization: 'Bearer t' }, cookies: {} } as never, ids);

    it('claims roster profiles whose email matches and skips the rest', async () => {
      mockAuthUser({ id: USER, email: EMAIL });
      const seeded = seedTables({
        persons: {
          rows: [
            // Seeded FIRST, so a lost `.eq('id', …)` claims whoever comes back
            // rather than the row the caller named.
            {
              id: 'decoy',
              email: 'someone@else.com',
              claimed_by_user_id: null,
              global_person_id: 'global-decoy',
            },
            {
              id: 'ok',
              email: 'Fighter@example.com',
              claimed_by_user_id: null,
              global_person_id: 'global-ok',
            },
            {
              id: 'bad',
              email: 'someone@else.com',
              claimed_by_user_id: null,
              global_person_id: null,
            },
          ],
        },
        global_persons: {
          rows: [
            { id: 'global-other', claimed_by_user_id: 'other-user', merged_into_id: null },
            { id: 'global-ok', claimed_by_user_id: null, merged_into_id: null },
          ],
        },
        fighter_clubs: { rows: [] },
      });

      // Email match is case-insensitive; a different address is skipped.
      await expect(claim(['ok', 'bad'])).resolves.toEqual({ claimed: 1 });

      const [flip] = writesTo(seeded, 'persons');
      expect(flip?.row).toMatchObject({ claim_status: 'claimed', claimed_by_user_id: USER });
      expect(scopedTo(flip, 'id')).toBe('ok');

      // …and the claim carries through to the global profile behind that row.
      const [link] = writesTo(seeded, 'global_persons');
      expect(link?.row).toMatchObject({ claimed_by_user_id: USER });
      expect(scopedTo(link, 'id')).toBe('global-ok');
      expect(isNullScoped(link, 'claimed_by_user_id')).toBe(true);
    });

    it('never reassigns a profile already owned by another user', async () => {
      mockAuthUser({ id: USER, email: EMAIL });
      const seeded = seedTables({
        persons: {
          rows: [
            { id: 'p', email: EMAIL, claimed_by_user_id: 'someone-else', global_person_id: 'g' },
          ],
        },
      });

      await expect(claim(['p'])).resolves.toEqual({ claimed: 0 });
      expect(writesTo(seeded, 'persons')).toEqual([]);
    });
  });

  /**
   * The silent auto-link of a user to their global profile, run at the tail of
   * every login. Two routes reach it: an EMAIL match against an unclaimed
   * profile, and — when that finds none — a repair from the Persons the user
   * has already claimed.
   *
   * The whole method sits inside a `catch` that logs and returns, so a fixture
   * the double refuses does NOT fail the test: it swallows the throw and
   * reports a silent no-op as success. That is why every table here is seeded
   * and why the assertions read the recorded WRITE. The old fixtures counted
   * `from()` calls instead, which says the code stopped somewhere without
   * saying it stopped before doing damage.
   */
  describe('tryAutolinkGlobalPerson', () => {
    const USER = 'user-1';
    const EMAIL = 'fighter@example.com';

    const globalPerson = (over: Record<string, unknown> = {}) => ({
      id: 'global-1',
      email: EMAIL,
      claimed_by_user_id: null,
      merged_into_id: null,
      club_id: null,
      ...over,
    });

    /**
     * Seeded FIRST, so each is what a lost filter hands back. One per axis the
     * profile reads narrow on: owned by someone else, this user's but merged
     * away, unclaimed but merged, and a different person's email.
     */
    const GLOBAL_DECOYS = [
      globalPerson({ id: 'global-taken', claimed_by_user_id: 'other-user', club_id: 'club-taken' }),
      globalPerson({ id: 'global-merged', claimed_by_user_id: USER, merged_into_id: 'global-1' }),
      globalPerson({ id: 'global-dupe', merged_into_id: 'global-1' }),
      globalPerson({ id: 'global-other-email', email: 'someone-else@example.com' }),
    ];

    /** Another user's claimed Person — newest, and with a club of its own. */
    const PERSON_DECOY = {
      id: 'p-other',
      claimed_by_user_id: 'other-user',
      global_person_id: 'global-taken',
      club_id: 'club-other-user',
      created_at: '2026-12-31T00:00:00Z',
    };

    const claimedPerson = (over: Record<string, unknown> = {}) => ({
      id: 'p-1',
      claimed_by_user_id: USER,
      global_person_id: 'global-1',
      club_id: null,
      created_at: '2026-03-01T00:00:00Z',
      ...over,
    });

    /** Carries a different email, so the candidate read finds none at all. */
    const repairTarget = globalPerson({ email: 'not-the-login@example.com' });

    it('links by email match, and flips that profile’s Persons to claimed', async () => {
      const seeded = seedTables({
        global_persons: { rows: [...GLOBAL_DECOYS, globalPerson()] },
        persons: { rows: [PERSON_DECOY, claimedPerson()] },
      });

      await service.tryAutolinkGlobalPerson(USER, EMAIL);

      const [link] = writesTo(seeded, 'global_persons');
      expect(link?.row).toMatchObject({ claimed_by_user_id: USER });
      expect(scopedTo(link, 'id')).toBe('global-1');
      // The race guard: only claim a profile still unclaimed.
      expect(isNullScoped(link, 'claimed_by_user_id')).toBe(true);

      const [sync] = writesTo(seeded, 'persons');
      expect(sync?.row).toEqual({ claim_status: 'claimed', claimed_by_user_id: USER });
      expect(scopedTo(sync, 'global_person_id')).toBe('global-1');
      expect(isNullScoped(sync, 'claimed_by_user_id')).toBe(true);
    });

    it('repairs from a claimed Person when exactly one profile sits behind them', async () => {
      const seeded = seedTables({
        global_persons: { rows: [...GLOBAL_DECOYS, repairTarget] },
        persons: { rows: [PERSON_DECOY, claimedPerson()] },
        fighter_clubs: { rows: [] },
      });

      await service.tryAutolinkGlobalPerson(USER, EMAIL);

      const [link] = writesTo(seeded, 'global_persons');
      expect(link?.row).toMatchObject({ claimed_by_user_id: USER });
      expect(scopedTo(link, 'id')).toBe('global-1');
      expect(isNullScoped(link, 'claimed_by_user_id')).toBe(true);
    });

    it('does not repair when the claimed Persons point at more than one profile', async () => {
      const seeded = seedTables({
        global_persons: { rows: [...GLOBAL_DECOYS, repairTarget] },
        persons: {
          rows: [
            PERSON_DECOY,
            claimedPerson(),
            claimedPerson({ id: 'p-2', global_person_id: 'global-other-email' }),
          ],
        },
      });

      await service.tryAutolinkGlobalPerson(USER, EMAIL);

      // What the old call-count assertion was reaching for, said directly:
      // an ambiguous history links nothing at all.
      expect(writesTo(seeded, 'global_persons')).toEqual([]);
    });

    it('does not repair onto a profile another user already owns', async () => {
      const seeded = seedTables({
        global_persons: { rows: [...GLOBAL_DECOYS, repairTarget] },
        persons: { rows: [PERSON_DECOY, claimedPerson({ global_person_id: 'global-taken' })] },
      });

      await service.tryAutolinkGlobalPerson(USER, EMAIL);

      expect(writesTo(seeded, 'global_persons')).toEqual([]);
    });

    /**
     * `seedClubFromPersons` had never run. Its own best-effort `catch` swallowed
     * a TypeError from the old double, which has no `.not`, so it aborted on its
     * second query every time while function coverage reported it exercised.
     */
    it('seeds the profile’s club from the newest claimed Person that has one', async () => {
      const seeded = seedTables({
        global_persons: { rows: [...GLOBAL_DECOYS, repairTarget] },
        persons: {
          rows: [
            PERSON_DECOY,
            claimedPerson({ id: 'p-old', club_id: 'club-old', created_at: '2026-01-02T00:00:00Z' }),
            claimedPerson({ id: 'p-new', club_id: 'club-new', created_at: '2026-06-01T00:00:00Z' }),
            claimedPerson({ id: 'p-newest', created_at: '2026-12-01T00:00:00Z' }),
          ],
        },
        fighter_clubs: {
          rows: [
            { id: 'fc-other', global_person_id: 'global-taken', role: 'main' },
            { id: 'fc-secondary', global_person_id: 'global-1', role: 'secondary' },
          ],
        },
      });

      await service.tryAutolinkGlobalPerson(USER, EMAIL);

      // `p-newest` is newer but has no club, and `p-other` is newer still but
      // belongs to another user — so the club comes from `p-new`.
      const [, club] = writesTo(seeded, 'global_persons');
      expect(club?.row).toMatchObject({ club_id: 'club-new' });
      expect(scopedTo(club, 'id')).toBe('global-1');
      // Never overwrite a club the profile already has.
      expect(isNullScoped(club, 'club_id')).toBe(true);

      const [main] = writesTo(seeded, 'fighter_clubs');
      expect(main?.op).toBe('insert');
      expect(main?.row).toEqual({
        global_person_id: 'global-1',
        club_id: 'club-new',
        role: 'main',
        sort_order: 0,
      });
    });
  });

  /**
   * Confirming a global-person claim from the emailed link — the one path that
   * hands a user someone's competition history on the strength of a token.
   *
   * Every table is seeded so the two guards can be asserted as OUTCOMES rather
   * than as arguments. The race guard is the interesting one: the claiming
   * update is scoped `claimed_by_user_id IS NULL` and reads itself back, so
   * seeding a profile already claimed makes that read-back return nothing —
   * which is exactly the branch that refuses the claim.
   */
  describe('confirmGlobalPersonClaim', () => {
    const USER = 'user-1';
    const TOKEN = 'claim-token';
    const hashOf = (raw: string) => createHash('sha256').update(raw).digest('hex');

    const tokenRow = (over: Record<string, unknown> = {}) => ({
      id: 'token-row-1',
      user_id: USER,
      global_person_id: 'global-1',
      expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      token_hash: hashOf(TOKEN),
      ...over,
    });

    /** Another user's live token, seeded FIRST — what a lost hash filter finds. */
    const TOKEN_DECOY = tokenRow({
      id: 'token-other',
      user_id: 'other-user',
      global_person_id: 'global-2',
      token_hash: hashOf('someone-elses-token'),
    });

    /** An unclaimed profile that is NOT the one the token names. */
    const GLOBAL_DECOY = { id: 'global-other', claimed_by_user_id: null };
    const unclaimedTarget = { id: 'global-1', claimed_by_user_id: null };

    const confirm = (raw = TOKEN) =>
      service.confirmGlobalPersonClaim(
        { headers: { authorization: 'Bearer t' }, cookies: {} } as never,
        raw,
      );

    it('claims the profile the token names, and flips its Persons to claimed', async () => {
      mockAuthUser({ id: USER, email: 'fighter@example.com' });
      const seeded = seedTables({
        global_person_claim_tokens: { rows: [TOKEN_DECOY, tokenRow()] },
        global_persons: { rows: [GLOBAL_DECOY, unclaimedTarget] },
        persons: { rows: [] },
      });

      await expect(confirm()).resolves.toEqual({ status: 'claimed', globalPersonId: 'global-1' });

      const [claim] = writesTo(seeded, 'global_persons');
      expect(claim?.row).toMatchObject({ claimed_by_user_id: USER });
      expect(scopedTo(claim, 'id')).toBe('global-1');
      expect(isNullScoped(claim, 'claimed_by_user_id')).toBe(true);

      const [sync] = writesTo(seeded, 'persons');
      expect(sync?.row).toEqual({ claim_status: 'claimed', claimed_by_user_id: USER });
      expect(scopedTo(sync, 'global_person_id')).toBe('global-1');
      expect(isNullScoped(sync, 'claimed_by_user_id')).toBe(true);
    });

    it('refuses a profile claimed in the racing window, and burns the token', async () => {
      mockAuthUser({ id: USER, email: 'fighter@example.com' });
      const seeded = seedTables({
        global_person_claim_tokens: { rows: [TOKEN_DECOY, tokenRow()] },
        global_persons: {
          rows: [GLOBAL_DECOY, { id: 'global-1', claimed_by_user_id: 'someone-else' }],
        },
        persons: { rows: [] },
      });

      await expect(confirm()).rejects.toThrow(/already_claimed/);
      // Nothing downstream may run on a claim that did not happen.
      expect(writesTo(seeded, 'persons')).toEqual([]);
      const [burn] = writesTo(seeded, 'global_person_claim_tokens');
      expect(burn?.op).toBe('delete');
      expect(scopedTo(burn, 'id')).toBe('token-row-1');
    });

    it('refuses a token issued to a different user', async () => {
      mockAuthUser({ id: USER, email: 'fighter@example.com' });
      const seeded = seedTables({
        global_person_claim_tokens: { rows: [tokenRow({ user_id: 'other-user' })] },
        global_persons: { rows: [unclaimedTarget] },
        persons: { rows: [] },
      });

      await expect(confirm()).rejects.toThrow(/user_mismatch/);
      expect(writesTo(seeded, 'global_persons')).toEqual([]);
    });

    it('burns an expired token instead of honouring it', async () => {
      mockAuthUser({ id: USER, email: 'fighter@example.com' });
      const seeded = seedTables({
        global_person_claim_tokens: {
          rows: [TOKEN_DECOY, tokenRow({ expires_at: new Date(Date.now() - 1_000).toISOString() })],
        },
        global_persons: { rows: [GLOBAL_DECOY, unclaimedTarget] },
        persons: { rows: [] },
      });

      await expect(confirm()).rejects.toThrow(/expired_or_used/);
      expect(writesTo(seeded, 'global_persons')).toEqual([]);
      const [burn] = writesTo(seeded, 'global_person_claim_tokens');
      expect(burn?.op).toBe('delete');
      expect(scopedTo(burn, 'id')).toBe('token-row-1');
    });

    it('looks the token up by hash, never by the raw value', async () => {
      mockAuthUser({ id: USER, email: 'fighter@example.com' });
      const seeded = seedTables({
        global_person_claim_tokens: { rows: [TOKEN_DECOY, tokenRow()] },
        global_persons: { rows: [GLOBAL_DECOY, unclaimedTarget] },
        persons: { rows: [] },
      });

      await confirm();

      const asked = filtersFor(seeded.from, 'global_person_claim_tokens', 'eq');
      expect(asked).toContainEqual(['token_hash', hashOf(TOKEN)]);
      // The raw token must never reach the database, under any column.
      for (const [column, value] of asked) {
        expect(column).not.toBe('token');
        expect(value).not.toBe(TOKEN);
      }
      // Single-use: the delete keys on the surrogate id, not the secret.
      const [burn] = writesTo(seeded, 'global_person_claim_tokens');
      expect(scopedTo(burn, 'id')).toBe('token-row-1');
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
