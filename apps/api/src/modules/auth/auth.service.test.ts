import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { AuthService } from './auth.service';

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
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
    update: vi.fn().mockReturnThis(),
  };
  return chain;
}

const mockMailService = {
  sendMagicLink: vi.fn().mockResolvedValue(undefined),
};

const mockConfigService = {
  getOrThrow: vi.fn(),
  get: vi.fn((key: string, defaultVal?: string) => {
    const values: Record<string, string> = {
      DOMAIN: 'myclash.localhost',
      MAIL_FROM: 'noreply@myclash.fr',
    };
    return values[key] ?? defaultVal ?? '';
  }),
};

// ── Tests ──────────────────────────────────────────────────────────────────

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(() => {
    vi.clearAllMocks();
    fromMock.mockReturnValue(makeQueryChain({ data: null, error: null }));

    // Instantiate directly — avoids NestJS DI metadata issues in Vitest
    service = new AuthService(
      mockSupabase as never,
      mockMailService as never,
      mockConfigService as never,
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
  });
});
