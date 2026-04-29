import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { GuestJwtService } from './guest-jwt.service';

// ── Mocks ──────────────────────────────────────────────────────────────────

const generateLinkMock = vi.fn();
const getUserMock = vi.fn();
const fromMock = vi.fn();

const mockSupabase = {
  service: {
    auth: { admin: { generateLink: generateLinkMock } },
    from: fromMock,
  },
  anon: {
    auth: { getUser: getUserMock, verifyOtp: vi.fn() },
  },
};

function makeQueryChain(result: unknown) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
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
    };
    return values[key] ?? def ?? '';
  }),
};

// Real GuestJwtService for integration-style tests
const guestJwtService = new GuestJwtService({
  getOrThrow: () => 'test-guest-secret-at-least-32-chars-long',
} as never);

// ── Tests ──────────────────────────────────────────────────────────────────

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(() => {
    vi.clearAllMocks();
    fromMock.mockReturnValue(makeQueryChain({ data: null, error: null }));

    service = new AuthService(
      mockSupabase as never,
      mockMailService as never,
      mockConfigService as never,
      guestJwtService,
    );
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
      getUserMock.mockResolvedValue({
        data: {
          user: {
            id: 'user-123',
            email: 'organizer@example.com',
            user_metadata: { display_name: 'Jean Dupont' },
          },
        },
        error: null,
      });

      const mockRequest = {
        headers: { authorization: 'Bearer valid-token' },
        cookies: {},
      } as never;

      const result = await service.getMe(mockRequest);
      expect(result.type).toBe('claimed');
      expect(result.user?.email).toBe('organizer@example.com');
    });

    it('returns anonymous when Supabase token is invalid', async () => {
      getUserMock.mockResolvedValue({
        data: { user: null },
        error: { message: 'Invalid token' },
      });

      const mockRequest = {
        headers: { authorization: 'Bearer bad-token' },
        cookies: {},
      } as never;

      const result = await service.getMe(mockRequest);
      expect(result.type).toBe('anonymous');
    });

    it('returns guest when valid mc_guest cookie present (no Supabase token)', async () => {
      getUserMock.mockResolvedValue({ data: { user: null }, error: { message: 'no token' } });

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
          data: { id: 'person-1', given_name: 'Jean', family_name: 'Dupont', event_id: 'event-1', claim_status: 'unclaimed' },
          error: null,
        }),
      };
      fromMock
        .mockReturnValueOnce(sessionChain)
        .mockReturnValueOnce(personChain);

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
    });

    it('claimed wins when both Supabase token and guest cookie present; clears guest cookie', async () => {
      getUserMock.mockResolvedValue({
        data: {
          user: { id: 'user-123', email: 'organizer@example.com', user_metadata: {} },
        },
        error: null,
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
      expect(clearCookieMock).toHaveBeenCalledWith('mc_guest', { path: '/' });
    });
  });
});
