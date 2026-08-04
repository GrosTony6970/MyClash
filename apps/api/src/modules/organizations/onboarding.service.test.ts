import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConflictException, BadRequestException } from '@nestjs/common';
import { LEGAL_POLICIES } from '@myclash/types';
import { LegalAcceptanceService } from '../privacy/legal-acceptance.service';
import { OnboardingService, type SignupResult } from './onboarding.service';
import { RESERVED_SLUGS } from './dto/signup.dto';

/**
 * Every signup carries the published versions — the DTO requires them and the
 * service checks them before it touches anything. Spread into each call so the
 * tests below stay about slugs and mail, not about consent.
 */
const ACCEPTED = {
  acceptedTerms: LEGAL_POLICIES.terms.version,
  acceptedPrivacy: LEGAL_POLICIES.privacy.version,
} as const;

// ── Mocks ──────────────────────────────────────────────────────────────────

const generateLinkMock = vi.fn();
const createUserMock = vi.fn();
const fromMock = vi.fn();

const mockSupabase = {
  service: {
    auth: {
      admin: {
        generateLink: generateLinkMock,
        createUser: createUserMock,
      },
    },
    from: fromMock,
  },
  anon: { auth: {} },
};

const mockMail = { sendMagicLink: vi.fn().mockResolvedValue(undefined) };

const mockConfig = {
  get: vi.fn((key: string, def?: string) => (key === 'DOMAIN' ? 'myclash.localhost' : (def ?? ''))),
  getOrThrow: vi.fn(),
};

// The REAL service over the mocked Supabase, not a stub: `assertCurrent` is the
// gate under test in the stale-version case below, and a stub that always says
// yes would make that test prove nothing.
const legalService = new LegalAcceptanceService(mockSupabase as never);

function makeQueryChain(result: unknown) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
    insert: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(result),
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('OnboardingService', () => {
  let service: OnboardingService;

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: slug not taken
    fromMock.mockReturnValue(makeQueryChain({ data: null, error: null }));
    service = new OnboardingService(
      mockSupabase as never,
      mockMail as never,
      mockConfig as never,
      legalService,
    );
  });

  describe('checkSlugAvailability', () => {
    it('returns unavailable for reserved slugs', async () => {
      for (const slug of RESERVED_SLUGS.slice(0, 3)) {
        const result = await service.checkSlugAvailability(slug);
        expect(result.available).toBe(false);
        expect(result.reason).toBe('reserved');
      }
    });

    it('returns available for a free slug', async () => {
      fromMock.mockReturnValue(makeQueryChain({ data: null, error: null }));
      const result = await service.checkSlugAvailability('lyon-amhe');
      expect(result.available).toBe(true);
    });

    it('returns unavailable for a taken slug', async () => {
      fromMock.mockReturnValue(makeQueryChain({ data: { id: 'org-1' }, error: null }));
      const result = await service.checkSlugAvailability('taken-slug');
      expect(result.available).toBe(false);
      expect(result.reason).toBe('taken');
    });
  });

  describe('signup — magic_link path', () => {
    it('sends magic link and returns orgSlug', async () => {
      fromMock.mockReturnValue(makeQueryChain({ data: null, error: null }));
      generateLinkMock.mockResolvedValue({
        data: { properties: { action_link: 'https://example.com/magic' } },
        error: null,
      });

      const result = await service.signup({
        email: 'jean@example.com',
        displayName: 'Jean Dupont',
        method: 'magic_link',
        orgName: 'Lyon AMHE',
        orgSlug: 'lyon-amhe',
        ...ACCEPTED,
      });

      expect((result as Extract<SignupResult, { type: 'magic_link' }>).type).toBe('magic_link');
      expect((result as Extract<SignupResult, { type: 'magic_link' }>).orgSlug).toBe('lyon-amhe');
      expect(mockMail.sendMagicLink).toHaveBeenCalledOnce();
    });

    it('throws ConflictException for reserved slug', async () => {
      await expect(
        service.signup({
          email: 'jean@example.com',
          displayName: 'Jean',
          method: 'magic_link',
          orgName: 'Admin Org',
          orgSlug: 'admin',
          ...ACCEPTED,
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('throws ConflictException for taken slug', async () => {
      fromMock.mockReturnValue(makeQueryChain({ data: { id: 'org-1' }, error: null }));
      await expect(
        service.signup({
          email: 'jean@example.com',
          displayName: 'Jean',
          method: 'magic_link',
          orgName: 'Lyon AMHE',
          orgSlug: 'taken-slug',
          ...ACCEPTED,
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('signup — password path', () => {
    it('creates user and returns emailVerificationRequired', async () => {
      fromMock.mockReturnValue(makeQueryChain({ data: null, error: null }));
      createUserMock.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null,
      });
      generateLinkMock.mockResolvedValue({
        data: { properties: { action_link: 'https://example.com/verify' } },
        error: null,
      });

      const result = await service.signup({
        email: 'jean@example.com',
        displayName: 'Jean Dupont',
        method: 'password',
        password: 'securepassword123',
        orgName: 'Lyon AMHE',
        orgSlug: 'lyon-amhe',
        ...ACCEPTED,
      });

      const typed = result as Extract<SignupResult, { type: 'password' }>;
      expect(typed.type).toBe('password');
      expect(typed.emailVerificationRequired).toBe(true);
    });

    it('throws BadRequestException when password is too short', async () => {
      fromMock.mockReturnValue(makeQueryChain({ data: null, error: null }));
      await expect(
        service.signup({
          email: 'jean@example.com',
          displayName: 'Jean',
          method: 'password',
          password: 'short',
          orgName: 'Lyon AMHE',
          orgSlug: 'lyon-amhe',
          ...ACCEPTED,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws ConflictException when email already registered', async () => {
      fromMock.mockReturnValue(makeQueryChain({ data: null, error: null }));
      createUserMock.mockResolvedValue({
        data: { user: null },
        error: { message: 'User already registered' },
      });

      await expect(
        service.signup({
          email: 'existing@example.com',
          displayName: 'Jean',
          method: 'password',
          password: 'securepassword123',
          orgName: 'Lyon AMHE',
          orgSlug: 'lyon-amhe',
          ...ACCEPTED,
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('signup — agreement', () => {
    it('refuses a stale policy version before creating anything', async () => {
      fromMock.mockReturnValue(makeQueryChain({ data: null, error: null }));

      await expect(
        service.signup({
          email: 'jean@example.com',
          displayName: 'Jean',
          method: 'password',
          password: 'securepassword123',
          orgName: 'Lyon AMHE',
          orgSlug: 'lyon-amhe',
          acceptedTerms: '1999-01-01',
          acceptedPrivacy: LEGAL_POLICIES.privacy.version,
        }),
      ).rejects.toThrow(BadRequestException);

      // The point of checking first: no account, and no email on its way to one.
      expect(createUserMock).not.toHaveBeenCalled();
      expect(mockMail.sendMagicLink).not.toHaveBeenCalled();
    });

    it('carries the accepted versions into the magic-link callback URL', async () => {
      // On this path no auth.users row exists yet, so the versions ride the
      // redirect rather than being stored — if they stop doing that, the
      // acceptance is silently never recorded for every magic-link organiser.
      fromMock.mockReturnValue(makeQueryChain({ data: null, error: null }));
      generateLinkMock.mockResolvedValue({
        data: { properties: { action_link: 'https://example.com/magic' } },
        error: null,
      });

      await service.signup({
        email: 'jean@example.com',
        displayName: 'Jean Dupont',
        method: 'magic_link',
        orgName: 'Lyon AMHE',
        orgSlug: 'lyon-amhe',
        ...ACCEPTED,
      });

      const redirectTo = generateLinkMock.mock.calls[0]?.[0]?.options?.redirectTo as string;
      expect(redirectTo).toContain(`acceptedTerms=${encodeURIComponent(ACCEPTED.acceptedTerms)}`);
      expect(redirectTo).toContain(
        `acceptedPrivacy=${encodeURIComponent(ACCEPTED.acceptedPrivacy)}`,
      );
    });
  });
});
