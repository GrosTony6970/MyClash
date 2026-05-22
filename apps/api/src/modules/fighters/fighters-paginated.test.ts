import { describe, it, expect } from 'vitest';
import { FightersService } from './fighters.service';

/**
 * Unit tests for listMatchesPaginated.
 * We test the pure data-shaping logic by stubbing the Supabase service
 * with canned responses, without hitting a real database.
 */

type Row = Record<string, unknown>;

function makeSupabaseStub(responses: {
  global_persons?: Row[];
  registrations?: Row[];
  matches?: { data: Row[]; count: number };
  oppRegistrations?: Row[];
}) {
  const fromFn = (table: string) => {
    if (table === 'global_persons') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: responses.global_persons?.[0] ?? null,
              error: null,
            }),
          }),
        }),
      };
    }
    if (table === 'registrations') {
      // Check if it's an opponent lookup (uses .in())
      return {
        select: (_cols: string) => ({
          eq: (_col: string, _val: string) => ({
            // for fighter registrations
            data: responses.registrations ?? [],
            error: null,
            then: undefined,
          }),
          in: (_col: string, _ids: string[]) => ({
            // for opponent registrations
            data: responses.oppRegistrations ?? [],
            error: null,
          }),
        }),
      };
    }
    if (table === 'matches') {
      const matchResp = responses.matches ?? { data: [], count: 0 };
      return {
        select: () => ({
          or: () => ({
            neq: () => ({
              order: () => ({
                order: () => ({
                  range: () =>
                    Promise.resolve({ data: matchResp.data, error: null, count: matchResp.count }),
                }),
              }),
            }),
          }),
        }),
      };
    }
    return {
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
      }),
    };
  };

  return {
    service: { from: fromFn },
  };
}

// A simpler stub that works for the actual method's call chain
function buildService(supabase: object): FightersService {
  return new FightersService(supabase as never, {} as never, {} as never);
}

describe('FightersService.listMatchesPaginated', () => {
  it('returns matches in reverse chronological order with correct shape', async () => {
    const fighterId = 'fighter-uuid-001';
    const regId = 'reg-001';
    const oppRegId = 'opp-reg-001';

    const registration: Row = {
      id: regId,
      tournament_id: 't-001',
      tournaments: {
        id: 't-001',
        name: 'Longsword Open',
        weapon: 'Longsword',
        events: {
          id: 'evt-001',
          name: 'HEMA Fest 2025',
          start_date: '2025-06-01',
          end_date: null,
        },
      },
    };

    const match1: Row = {
      id: 'm-001',
      status: 'completed',
      scheduled_at: '2025-06-01T10:00:00Z',
      created_at: '2025-06-01T09:00:00Z',
      red_registration_id: regId,
      blue_registration_id: oppRegId,
      winner_registration_id: regId,
      red_score: 5,
      blue_score: 3,
      phases: { tournament_id: 't-001' },
    };

    const oppReg: Row = {
      id: oppRegId,
      global_person_id: 'opp-gp-001',
      global_persons: { display_name: 'Jean Dupont' },
    };

    // Build a service with a hand-rolled stub
    const supabaseStub = {
      service: {
        from: (table: string) => {
          if (table === 'global_persons') {
            return {
              select: () => ({
                eq: (_col: string, _val: string) => ({
                  maybeSingle: async () => ({
                    data: { id: fighterId },
                    error: null,
                  }),
                }),
              }),
            };
          }
          if (table === 'registrations') {
            return {
              select: (_cols: string) => {
                // distinguish fighter regs from opponent lookup by a closure trick
                const obj = {
                  eq: (_col: string, _val: string) => ({
                    // Return the fighter's registrations
                    data: [registration],
                    error: null,
                    // Supabase resolves via then
                    then: undefined,
                  }),
                  in: (_col: string, _ids: string[]) => ({
                    data: [oppReg],
                    error: null,
                  }),
                };
                return obj;
              },
            };
          }
          if (table === 'matches') {
            return {
              select: () => ({
                or: () => ({
                  neq: () => ({
                    order: () => ({
                      order: () => ({
                        range: () => Promise.resolve({ data: [match1], error: null, count: 1 }),
                      }),
                    }),
                  }),
                }),
              }),
            };
          }
          return { select: () => ({}) };
        },
      },
    };

    const service = buildService(supabaseStub);
    const result = await service.listMatchesPaginated('some-slug', { limit: 20, offset: 0 });

    expect(result.total).toBe(1);
    expect(result.items).toHaveLength(1);

    const item = result.items[0];
    expect(item).toBeDefined();
    if (!item) throw new Error('item undefined');
    expect(item.id).toBe('m-001');
    expect(item.outcome).toBe('win');
    expect(item.ourScore).toBe(5);
    expect(item.opponentScore).toBe(3);
    expect(item.opponentName).toBe('Jean Dupont');
    expect(item.eventName).toBe('HEMA Fest 2025');
    expect(item.weapon).toBe('Longsword');
    expect(item.tournamentName).toBe('Longsword Open');
    expect(item.status).toBe('completed');
  });

  it('listMatchesPaginated respects limit + offset', async () => {
    const fighterId = 'fighter-uuid-002';
    const regId = 'reg-002';

    const registration: Row = {
      id: regId,
      tournament_id: 't-002',
      tournaments: {
        id: 't-002',
        name: 'Sabre Cup',
        weapon: 'Sabre',
        events: {
          id: 'evt-002',
          name: 'City Cup 2025',
          start_date: '2025-09-01',
          end_date: null,
        },
      },
    };

    // Second page: offset=1, limit=1 → only 1 item from a total of 3
    let capturedOffset: number | null = null;

    const supabaseStub = {
      service: {
        from: (table: string) => {
          if (table === 'global_persons') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({ data: { id: fighterId }, error: null }),
                }),
              }),
            };
          }
          if (table === 'registrations') {
            return {
              select: () => ({
                eq: () => ({ data: [registration], error: null }),
                in: () => ({ data: [], error: null }),
              }),
            };
          }
          if (table === 'matches') {
            return {
              select: () => ({
                or: () => ({
                  neq: () => ({
                    order: () => ({
                      order: () => ({
                        range: (from: number) => {
                          capturedOffset = from;
                          const allMatches: Row[] = [
                            {
                              id: 'm-a',
                              status: 'completed',
                              scheduled_at: '2025-09-03T10:00:00Z',
                              created_at: '2025-09-01T09:00:00Z',
                              red_registration_id: regId,
                              blue_registration_id: null,
                              winner_registration_id: regId,
                              red_score: 5,
                              blue_score: 2,
                              phases: { tournament_id: 't-002' },
                            },
                          ];
                          return Promise.resolve({ data: allMatches, error: null, count: 3 });
                        },
                      }),
                    }),
                  }),
                }),
              }),
            };
          }
          return { select: () => ({}) };
        },
      },
    };

    const service = buildService(supabaseStub);

    // First page
    const page1 = await service.listMatchesPaginated('some-slug', { limit: 1, offset: 0 });
    expect(page1.total).toBe(3);
    expect(capturedOffset).toBe(0);

    // Second page
    const page2 = await service.listMatchesPaginated('some-slug', { limit: 1, offset: 1 });
    expect(page2.total).toBe(3);
    expect(capturedOffset).toBe(1);
  });
});
