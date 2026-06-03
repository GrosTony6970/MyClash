import { ConflictException, ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { VenuesService } from './venues.service';

type QueryResult = { data: unknown; error: { message: string } | null };
type CountResult = { count: number | null; error: { message: string } | null };

function chain(result: QueryResult) {
  const api = {
    select: vi.fn(() => api),
    eq: vi.fn(() => api),
    in: vi.fn(() => api),
    is: vi.fn(() => api),
    not: vi.fn(() => api),
    order: vi.fn(() => api),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
    single: vi.fn(() => Promise.resolve(result)),
    then: undefined,
  };
  return api;
}

type CountChain = Promise<CountResult> & {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
};
function countChain(result: CountResult): CountChain {
  const promise = Promise.resolve(result);
  const api: CountChain = Object.assign(promise, {
    select: vi.fn(() => api),
    eq: vi.fn(() => api),
  });
  return api;
}

describe('VenuesService', () => {
  describe('create', () => {
    it('inserts the venue with the org id and returns the row when the caller is an org admin', async () => {
      const inserted: Array<Record<string, unknown>> = [];
      const venuesTable = {
        insert: vi.fn((payload: Record<string, unknown>) => {
          inserted.push(payload);
          return chain({
            data: { id: 'venue-1', ...payload },
            error: null,
          });
        }),
      };
      const supabase = {
        service: {
          from: vi.fn((table: string) => {
            if (table === 'venues') return venuesTable;
            return chain({ data: null, error: null });
          }),
        },
      };
      const assertOrgRole = vi.fn().mockResolvedValue(undefined);
      const service = new VenuesService(supabase as never, { assertOrgRole } as never);

      const venue = await service.create(
        'org-1',
        { name: 'Gymnase Lyon-Sud', hostsTournament: true, hostsWorkshop: false },
        'user-1',
      );

      expect(assertOrgRole).toHaveBeenCalledWith('org-1', 'user-1', 'admin');
      expect(inserted[0]).toMatchObject({
        organization_id: 'org-1',
        name: 'Gymnase Lyon-Sud',
        hosts_tournament: true,
        hosts_workshop: false,
      });
      expect((venue as { id: string }).id).toBe('venue-1');
    });

    it('rejects creation when the caller is not an org admin', async () => {
      const supabase = { service: { from: vi.fn(() => chain({ data: null, error: null })) } };
      const assertOrgRole = vi
        .fn()
        .mockRejectedValue(new ForbiddenException('Requires admin role or higher'));
      const service = new VenuesService(supabase as never, { assertOrgRole } as never);

      await expect(
        service.create('org-1', { name: 'X' } as never, 'user-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('delete', () => {
    it('refuses to delete a venue that still has lices pointing at it', async () => {
      // Venue lookup → returns org id for auth.
      const venueRow = { organization_id: 'org-1' };
      // Counts: 2 lices, 0 sessions.
      const liceCount = countChain({ count: 2, error: null });
      const sessionCount = countChain({ count: 0, error: null });
      const supabase = {
        service: {
          from: vi.fn((table: string) => {
            if (table === 'venues') return chain({ data: venueRow, error: null });
            if (table === 'lices') return liceCount;
            if (table === 'workshop_sessions') return sessionCount;
            return chain({ data: null, error: null });
          }),
        },
      };
      const assertOrgRole = vi.fn().mockResolvedValue(undefined);
      const service = new VenuesService(supabase as never, { assertOrgRole } as never);

      await expect(service.delete('venue-1', 'user-1')).rejects.toBeInstanceOf(ConflictException);
    });

    it('deletes the venue when no lice or session points at it', async () => {
      const deleteCalls: Array<{ id: string }> = [];
      const liceCount = countChain({ count: 0, error: null });
      const sessionCount = countChain({ count: 0, error: null });
      let venuesCalls = 0;
      const supabase = {
        service: {
          from: vi.fn((table: string) => {
            if (table === 'lices') return liceCount;
            if (table === 'workshop_sessions') return sessionCount;
            if (table === 'venues') {
              venuesCalls += 1;
              // 1st `from('venues')` call: assertCanManageVenue() does
              // .select().eq().maybeSingle() to fetch the org_id.
              if (venuesCalls === 1) {
                return chain({ data: { organization_id: 'org-1' }, error: null });
              }
              // 2nd call: the actual delete chain.
              return {
                delete: vi.fn(() => ({
                  eq: vi.fn((_col: string, id: string) => {
                    deleteCalls.push({ id });
                    return Promise.resolve({ error: null });
                  }),
                })),
              };
            }
            return chain({ data: null, error: null });
          }),
        },
      };
      const assertOrgRole = vi.fn().mockResolvedValue(undefined);
      const service = new VenuesService(supabase as never, { assertOrgRole } as never);

      await expect(service.delete('venue-1', 'user-1')).resolves.toBeUndefined();
      expect(deleteCalls).toEqual([{ id: 'venue-1' }]);
    });
  });
});
