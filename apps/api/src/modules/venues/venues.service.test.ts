import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
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

  describe('tournament phase venues', () => {
    type AnyChain = Promise<unknown> & {
      select: ReturnType<typeof vi.fn>;
      eq: ReturnType<typeof vi.fn>;
      in: ReturnType<typeof vi.fn>;
      is: ReturnType<typeof vi.fn>;
      not: ReturnType<typeof vi.fn>;
      order: ReturnType<typeof vi.fn>;
      delete: ReturnType<typeof vi.fn>;
      maybeSingle: ReturnType<typeof vi.fn>;
      single: ReturnType<typeof vi.fn>;
      insert: ReturnType<typeof vi.fn>;
      upsert: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    // A thenable chain that ALSO answers .maybeSingle()/write verbs, so one
    // per-table stub serves both awaited list reads and .maybeSingle() reads.
    function q(awaitResult: unknown, singleResult: unknown = awaitResult): AnyChain {
      const promise = Promise.resolve(awaitResult);
      const api: AnyChain = Object.assign(promise, {
        select: vi.fn(() => api),
        eq: vi.fn(() => api),
        in: vi.fn(() => api),
        is: vi.fn(() => api),
        not: vi.fn(() => api),
        order: vi.fn(() => api),
        delete: vi.fn(() => api),
        maybeSingle: vi.fn(() => Promise.resolve(singleResult)),
        single: vi.fn(() => Promise.resolve(singleResult)),
        insert: vi.fn(() => Promise.resolve({ data: null, error: null })),
        upsert: vi.fn(() => Promise.resolve({ data: null, error: null })),
        update: vi.fn(() => api),
      });
      return api;
    }

    it('getTournamentPhaseVenues maps rows into { pool, bracket }', async () => {
      const phaseVenues = q({
        data: [
          { phase_kind: 'pool', venues: { id: 'v-1', name: 'Hall A' } },
          { phase_kind: 'bracket', venues: { id: 'v-2', name: 'Hall B' } },
        ],
        error: null,
      });
      const supabase = {
        service: {
          from: vi.fn((table: string) =>
            table === 'tournament_phase_venues' ? phaseVenues : q({ data: null, error: null }),
          ),
        },
      };
      const assertOrgRole = vi.fn().mockResolvedValue(undefined);
      const service = new VenuesService(supabase as never, { assertOrgRole } as never);

      const result = await service.getTournamentPhaseVenues('t-1');
      expect(result).toEqual({
        pool: { id: 'v-1', name: 'Hall A' },
        // A Swiss phase gets its own hall — unassigned here.
        swiss: null,
        bracket: { id: 'v-2', name: 'Hall B' },
      });
    });

    it('setTournamentPhaseVenues upserts the pool venue (admin) + links it to the event', async () => {
      const upsertCalls: Array<Record<string, unknown>> = [];
      const eventVenueInserts: Array<Record<string, unknown>> = [];

      const tournamentChain = q({ data: { id: 't-1', event_id: 'e-1' }, error: null });
      const eventChain = q({ data: { id: 'e-1', organization_id: 'org-1' }, error: null });
      // venues answers BOTH the org-validation list AND ensureEventVenueLinked's
      // .maybeSingle() (hosts_tournament lookup).
      const venuesChain = q(
        { data: [{ id: 'v-1' }], error: null },
        { data: { id: 'v-1', organization_id: 'org-1', hosts_tournament: true }, error: null },
      );
      const phaseVenuesChain = q({
        data: [{ phase_kind: 'pool', venues: { id: 'v-1', name: 'Hall A' } }],
        error: null,
      });
      phaseVenuesChain.upsert = vi.fn((payload: Record<string, unknown>) => {
        upsertCalls.push(payload);
        return Promise.resolve({ data: null, error: null });
      });
      const eventVenuesChain = q({ count: 0, error: null }); // no existing link → insert
      eventVenuesChain.insert = vi.fn((payload: Record<string, unknown>) => {
        eventVenueInserts.push(payload);
        return Promise.resolve({ data: null, error: null });
      });
      const licesChain = q({ count: 0, error: null });
      const venueLicesChain = q({ data: [], error: null }); // empty catalogue → no seeding

      const supabase = {
        service: {
          from: vi.fn((table: string) => {
            if (table === 'tournaments') return tournamentChain;
            if (table === 'events') return eventChain;
            if (table === 'venues') return venuesChain;
            if (table === 'tournament_phase_venues') return phaseVenuesChain;
            if (table === 'event_venues') return eventVenuesChain;
            if (table === 'lices') return licesChain;
            if (table === 'venue_lices') return venueLicesChain;
            return q({ data: null, error: null });
          }),
        },
      };
      const assertOrgRole = vi.fn().mockResolvedValue(undefined);
      const service = new VenuesService(supabase as never, { assertOrgRole } as never);

      const result = await service.setTournamentPhaseVenues('t-1', { pool: 'v-1' }, 'user-1');

      expect(assertOrgRole).toHaveBeenCalledWith('org-1', 'user-1', 'admin');
      expect(upsertCalls[0]).toMatchObject({
        tournament_id: 't-1',
        phase_kind: 'pool',
        venue_id: 'v-1',
      });
      expect(eventVenueInserts[0]).toMatchObject({ event_id: 'e-1', venue_id: 'v-1' });
      expect(result).toEqual({
        pool: { id: 'v-1', name: 'Hall A' },
        swiss: null,
        bracket: null,
      });
    });

    it('setTournamentPhaseVenues rejects a venue from another org', async () => {
      const supabase = {
        service: {
          from: vi.fn((table: string) => {
            if (table === 'tournaments')
              return q({ data: { id: 't-1', event_id: 'e-1' }, error: null });
            if (table === 'events')
              return q({ data: { id: 'e-1', organization_id: 'org-1' }, error: null });
            if (table === 'venues') return q({ data: [], error: null }); // not in org
            return q({ data: null, error: null });
          }),
        },
      };
      const assertOrgRole = vi.fn().mockResolvedValue(undefined);
      const service = new VenuesService(supabase as never, { assertOrgRole } as never);

      await expect(
        service.setTournamentPhaseVenues('t-1', { pool: 'v-foreign' }, 'user-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('applyTournamentPhaseVenue round-robins a phase’s matches onto the venue lices', async () => {
      const updateCalls: Array<{ liceId: string; ids: string[] }> = [];
      const matchesChain = q({
        data: [
          { id: 'm1', scheduled_at: '2026-06-26T10:00:00Z' },
          { id: 'm2', scheduled_at: '2026-06-26T10:05:00Z' },
          { id: 'm3', scheduled_at: '2026-06-26T10:10:00Z' },
        ],
        error: null,
      });
      matchesChain.update = vi.fn((payload: { lice_id: string }) => ({
        in: vi.fn((_col: string, ids: string[]) => {
          updateCalls.push({ liceId: payload.lice_id, ids });
          return Promise.resolve({ data: null, error: null });
        }),
      }));

      const supabase = {
        service: {
          from: vi.fn((table: string) => {
            if (table === 'tournaments')
              return q({ data: { id: 't-1', event_id: 'e-1' }, error: null });
            if (table === 'events')
              return q({ data: { id: 'e-1', organization_id: 'org-1' }, error: null });
            if (table === 'tournament_phase_venues')
              return q({ data: { venue_id: 'v-1' }, error: null });
            if (table === 'phases') return q({ data: [{ id: 'phase-1' }], error: null });
            if (table === 'lices')
              return q({ data: [{ id: 'lice-a' }, { id: 'lice-b' }], error: null });
            if (table === 'matches') return matchesChain;
            return q({ data: null, error: null });
          }),
        },
      };
      const assertOrgRole = vi.fn().mockResolvedValue(undefined);
      const service = new VenuesService(supabase as never, { assertOrgRole } as never);

      const result = await service.applyTournamentPhaseVenue('t-1', 'pool', 'user-1');

      expect(assertOrgRole).toHaveBeenCalledWith('org-1', 'user-1', 'admin');
      expect(result).toEqual({ moved: 3, venueId: 'v-1' });
      const byLice = new Map(updateCalls.map((c) => [c.liceId, c.ids]));
      expect(byLice.get('lice-a')).toEqual(['m1', 'm3']);
      expect(byLice.get('lice-b')).toEqual(['m2']);
    });

    it('applyTournamentPhaseVenue rejects when no venue is assigned for the kind', async () => {
      const supabase = {
        service: {
          from: vi.fn((table: string) => {
            if (table === 'tournaments')
              return q({ data: { id: 't-1', event_id: 'e-1' }, error: null });
            if (table === 'events')
              return q({ data: { id: 'e-1', organization_id: 'org-1' }, error: null });
            if (table === 'tournament_phase_venues') return q({ data: null, error: null });
            return q({ data: null, error: null });
          }),
        },
      };
      const assertOrgRole = vi.fn().mockResolvedValue(undefined);
      const service = new VenuesService(supabase as never, { assertOrgRole } as never);

      await expect(
        service.applyTournamentPhaseVenue('t-1', 'pool', 'user-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
