import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { OrganizationsService } from './organizations.service';

// ── Mocks ──────────────────────────────────────────────────────────────────

const fromMock = vi.fn();
const mockSupabase = { service: { from: fromMock }, anon: {} };

/**
 * Creates a mock Supabase query chain.
 * Returns a plain object — NOT a Promise — so spreading it is safe.
 * For `await chain` patterns in the service, the service uses `.maybeSingle()`
 * or `.single()` as the terminal call, which return Promises.
 */
function makeChain(result: unknown) {
  const chain = {
    select: vi.fn() as ReturnType<typeof vi.fn>,
    eq: vi.fn() as ReturnType<typeof vi.fn>,
    in: vi.fn() as ReturnType<typeof vi.fn>,
    order: vi.fn() as ReturnType<typeof vi.fn>,
    insert: vi.fn() as ReturnType<typeof vi.fn>,
    update: vi.fn() as ReturnType<typeof vi.fn>,
    upsert: vi.fn() as ReturnType<typeof vi.fn>,
    maybeSingle: vi.fn().mockResolvedValue(result),
    single: vi.fn().mockResolvedValue(result),
  };
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.in.mockReturnValue(chain);
  chain.order.mockReturnValue(chain);
  chain.insert.mockReturnValue(chain);
  chain.update.mockReturnValue(chain);
  chain.upsert.mockReturnValue(chain);
  return chain;
}

function makeAwaitableChain(result: unknown) {
  const promise = Promise.resolve(result);
  const methods = {
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    order: vi.fn(),
  };
  const chain = Object.assign(promise, methods);
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.in.mockReturnValue(chain);
  chain.order.mockReturnValue(chain);
  return chain;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('OrganizationsService', () => {
  let service: OrganizationsService;

  beforeEach(() => {
    vi.clearAllMocks();
    fromMock.mockReturnValue(makeChain({ data: null, error: null }));
    service = new OrganizationsService(mockSupabase as never);
  });

  describe('create', () => {
    it('creates with status=pending_approval', async () => {
      // slug check: not taken
      const slugChain = makeChain({ data: null, error: null });
      slugChain.maybeSingle.mockResolvedValue({ data: null, error: null });

      const insertChain = makeChain({ data: null, error: null });
      insertChain.single.mockResolvedValue({
        data: { id: 'org-1', status: 'pending_approval' },
        error: null,
      });

      const memberChain = makeChain({ data: null, error: null });
      memberChain.insert.mockResolvedValue({ data: null, error: null });

      fromMock
        .mockReturnValueOnce(slugChain)
        .mockReturnValueOnce(insertChain)
        .mockReturnValueOnce(memberChain);

      const result = await service.create({ name: 'Test Org', slug: 'test-org' }, 'user-1');
      expect((result as { status: string }).status).toBe('pending_approval');
    });

    it('throws ConflictException when slug is taken', async () => {
      const chain = makeChain({ data: null, error: null });
      chain.maybeSingle.mockResolvedValue({ data: { id: 'existing' }, error: null });
      fromMock.mockReturnValue(chain);

      await expect(service.create({ name: 'Test', slug: 'taken-slug' }, 'user-1')).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('getBySlug', () => {
    it('projects logo_url so the org Overview page can render the uploaded logo after refetch', async () => {
      // Regression guard: before this fix, getBySlug selected only
      // `id, name, slug, status` and dropped logo_url, so the FE refetch
      // after a successful logo upload silently overwrote logoUrl → null.
      const chain = makeChain({ data: null, error: null });
      chain.maybeSingle.mockResolvedValue({
        data: {
          id: 'org-1',
          name: 'Test Org',
          slug: 'test-org',
          status: 'active',
          logo_url: 'https://cdn.test/organizations/org-1/logo.png',
        },
        error: null,
      });
      fromMock.mockReturnValue(chain);

      const result = (await service.getBySlug('test-org')) as Record<string, unknown>;

      expect(chain.select).toHaveBeenCalledWith(expect.stringContaining('logo_url'));
      expect(result['logo_url']).toBe('https://cdn.test/organizations/org-1/logo.png');
    });
  });

  describe('assertOrgRole', () => {
    it('throws ForbiddenException when user is not a member', async () => {
      const chain = makeChain({ data: null, error: null });
      chain.maybeSingle.mockResolvedValue({ data: null, error: null });
      fromMock.mockReturnValue(chain);

      await expect(service.assertOrgRole('org-1', 'user-1', 'admin')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('throws ForbiddenException when role is insufficient', async () => {
      const chain = makeChain({ data: null, error: null });
      chain.maybeSingle.mockResolvedValue({ data: { role: 'read_only' }, error: null });
      fromMock.mockReturnValue(chain);

      await expect(service.assertOrgRole('org-1', 'user-1', 'admin')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('passes when user has sufficient role', async () => {
      const chain = makeChain({ data: null, error: null });
      chain.maybeSingle.mockResolvedValue({ data: { role: 'owner' }, error: null });
      fromMock.mockReturnValue(chain);

      await expect(service.assertOrgRole('org-1', 'user-1', 'admin')).resolves.not.toThrow();
    });
  });

  describe('dashboardStats', () => {
    it('counts event participations for fighters and referees', async () => {
      const membershipChain = makeChain({ data: null, error: null });
      membershipChain.maybeSingle.mockResolvedValue({ data: { role: 'admin' }, error: null });

      const eventsChain = makeAwaitableChain({
        data: [
          { id: 'event-1', start_date: '2099-01-01' },
          { id: 'event-2', start_date: '2020-01-01' },
        ],
        error: null,
      });

      const tournamentsChain = makeAwaitableChain({
        data: [{ id: 'tournament-1' }, { id: 'tournament-2' }],
        error: null,
      });

      const registrationsChain = makeAwaitableChain({
        data: [{ id: 'registration-1' }, { id: 'registration-2' }, { id: 'registration-3' }],
        error: null,
      });

      const refereesChain = makeAwaitableChain({
        data: [{ id: 'referee-1' }, { id: 'referee-2' }],
        error: null,
      });

      fromMock
        .mockReturnValueOnce(membershipChain)
        .mockReturnValueOnce(eventsChain)
        .mockReturnValueOnce(tournamentsChain)
        .mockReturnValueOnce(registrationsChain)
        .mockReturnValueOnce(refereesChain);

      await expect(service.dashboardStats('org-1', 'user-1')).resolves.toEqual({
        eventsTotal: 2,
        upcomingEvents: 1,
        tournamentsTotal: 2,
        fighterParticipations: 3,
        refereeParticipations: 2,
      });
    });
  });

  // ── R4: org logo upload ─────────────────────────────────────────────────

  describe('uploadLogo', () => {
    it('asserts admin role, uploads to event-assets, and writes same-origin logo_url', async () => {
      const membershipChain = makeChain({ data: null, error: null });
      membershipChain.maybeSingle.mockResolvedValue({ data: { role: 'admin' }, error: null });

      // The update chain only needs .update().eq() to be awaitable.
      const updateResult = Promise.resolve({ data: null, error: null });
      const updateChain = {
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnValue(updateResult),
      };

      fromMock.mockReturnValueOnce(membershipChain).mockReturnValueOnce(updateChain);

      const storage = {
        getBucket: vi.fn().mockResolvedValue({ data: { name: 'event-assets' }, error: null }),
        createBucket: vi.fn(),
        from: vi.fn().mockReturnValue({
          upload: vi.fn().mockResolvedValue({ error: null }),
          // getPublicUrl is no longer called by uploadLogo — the
          // service constructs a same-origin relative path instead so
          // the IMG resolves to whichever admin/app origin loaded the
          // bundle. Keep the mock so a regression that re-introduces
          // getPublicUrl doesn't crash this test silently.
          getPublicUrl: vi.fn().mockReturnValue({
            data: { publicUrl: 'https://cdn.test/should-not-be-used' },
          }),
        }),
      };
      service = new OrganizationsService({
        service: { from: fromMock, storage },
        anon: {},
      } as never);

      const result = await service.uploadLogo('org-1', 'user-1', {
        buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
        filename: 'logo.png',
        mimetype: 'image/png',
      });

      // Relative same-origin path — IMG resolves to whichever
      // admin/app origin loaded the bundle, no cross-origin roundtrip.
      expect(result.url).toMatch(
        /^\/storage\/v1\/object\/public\/event-assets\/organizations\/org-1\/logo-\d+-logo\.png$/,
      );
      expect(storage.from).toHaveBeenCalledWith('event-assets');
      expect(updateChain.update).toHaveBeenCalledWith(
        expect.objectContaining({
          logo_url: expect.stringMatching(
            /^\/storage\/v1\/object\/public\/event-assets\/organizations\/org-1\/logo-\d+-logo\.png$/,
          ) as unknown,
        }),
      );
    });

    it('rejects non-image mimetypes', async () => {
      const membershipChain = makeChain({ data: null, error: null });
      membershipChain.maybeSingle.mockResolvedValue({ data: { role: 'admin' }, error: null });
      fromMock.mockReturnValueOnce(membershipChain);

      await expect(
        service.uploadLogo('org-1', 'user-1', {
          buffer: Buffer.from('hello'),
          filename: 'logo.svg',
          mimetype: 'image/svg+xml',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
