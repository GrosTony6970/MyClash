import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AssignmentsService, BLOCKING_MATCH_STATUSES } from './assignments.service';

// Mocks mirror the per-table dispatch pattern used elsewhere in the
// API service tests — one `fromMock` reused, branched by `tableName`.

const fromMock = vi.fn();
const mockSupabase = { service: { from: fromMock } };

function awaitableChain(result: { data: unknown; error: unknown }) {
  const promise = Promise.resolve(result);
  const chain = Object.assign(promise, {
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    or: vi.fn(),
    order: vi.fn(),
    delete: vi.fn(),
    update: vi.fn(),
    insert: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue(result),
    single: vi.fn().mockResolvedValue(result),
  });
  for (const key of ['select', 'eq', 'in', 'or', 'order', 'delete', 'update', 'insert']) {
    (chain as unknown as Record<string, unknown>)[key] = vi.fn().mockReturnValue(chain);
  }
  // `.limit(1)` is only the referee lock's read here (referee-lock.ts). A canned table
  // answers every read alike, so these fixtures say "unlocked" explicitly; the locked
  // cases are `assignments.force-delete-lock.test.ts`'s, over a seeded table.
  return Object.assign(chain, {
    limit: vi.fn().mockResolvedValue({ data: [], error: null }),
  });
}

describe('AssignmentsService.getEventAssignments', () => {
  let service: AssignmentsService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AssignmentsService(mockSupabase as never);
  });

  it('flags hasBlockingMatch when the person has a completed match as a fighter', async () => {
    fromMock.mockImplementation((tableName: string) => {
      if (tableName === 'registrations') {
        return awaitableChain({
          data: [
            {
              id: 'reg-1',
              tournament_id: 't-1',
              tournaments: { id: 't-1', name: 'Longsword', event_id: 'event-1' },
            },
          ],
          error: null,
        });
      }
      if (tableName === 'pool_members') {
        return awaitableChain({
          data: [
            {
              registration_id: 'reg-1',
              pools: {
                id: 'pool-1',
                name: 'Pool A',
                phases: { tournament_id: 't-1', tournaments: { id: 't-1', name: 'Longsword' } },
              },
            },
          ],
          error: null,
        });
      }
      if (tableName === 'bracket_slots') {
        return awaitableChain({ data: [], error: null });
      }
      if (tableName === 'vw_tournament_query_matches') {
        return awaitableChain({
          data: [
            {
              match_id: 'm-scheduled',
              match_number_label: 'L1-PA-M1',
              status: 'scheduled',
              tournament_id: 't-1',
              red_registration_id: 'reg-1',
              blue_registration_id: 'other',
            },
            {
              match_id: 'm-done',
              match_number_label: 'L1-PA-M5',
              status: 'completed',
              tournament_id: 't-1',
              red_registration_id: 'reg-1',
              blue_registration_id: 'other',
            },
          ],
          error: null,
        });
      }
      if (tableName === 'matches') {
        return awaitableChain({ data: [], error: null });
      }
      if (tableName === 'referee_assignments') {
        return awaitableChain({ data: [], error: null });
      }
      return awaitableChain({ data: null, error: null });
    });

    const report = await service.getEventAssignments('event-1', 'person-1');

    expect(report.hasBlockingMatch).toBe(true);
    expect(report.blockingMatches).toEqual([
      { matchId: 'm-done', label: 'L1-PA-M5', status: 'completed', reason: 'fighter' },
    ]);
    expect(report.matchesAsFighter).toHaveLength(2);
    expect(report.pools).toEqual([
      { poolId: 'pool-1', poolName: 'Pool A', tournamentId: 't-1', tournamentName: 'Longsword' },
    ]);
  });

  // vw_tournament_query_matches has never projected tournament_name. Asking for
  // it 400'd the whole query, and the dropped error turned that into an empty
  // matchesAsFighter — so a fighter's own matches never blocked a deletion and
  // never rendered. The name is resolved from the registration embed instead.
  it('does not ask the view for a column it does not project', async () => {
    const selectArgs: string[] = [];
    fromMock.mockImplementation((tableName: string) => {
      if (tableName === 'registrations') {
        return awaitableChain({
          data: [
            {
              id: 'reg-1',
              tournament_id: 't-1',
              tournaments: { id: 't-1', name: 'Longsword', event_id: 'event-1' },
            },
          ],
          error: null,
        });
      }
      if (tableName === 'vw_tournament_query_matches') {
        const chain = awaitableChain({
          data: [
            {
              match_id: 'm-1',
              match_number_label: 'L1-PA-M1',
              status: 'scheduled',
              tournament_id: 't-1',
              red_registration_id: 'reg-1',
              blue_registration_id: 'other',
            },
          ],
          error: null,
        });
        chain.select = vi.fn().mockImplementation((columns: string) => {
          selectArgs.push(columns);
          return chain;
        });
        return chain;
      }
      return awaitableChain({ data: [], error: null });
    });

    const report = await service.getEventAssignments('event-1', 'person-1');

    expect(selectArgs).toHaveLength(1);
    expect(selectArgs[0]).not.toContain('tournament_name');
    // Still named, resolved through the registration the match was matched on.
    expect(report.matchesAsFighter).toEqual([
      {
        matchId: 'm-1',
        label: 'L1-PA-M1',
        status: 'scheduled',
        tournamentId: 't-1',
        tournamentName: 'Longsword',
      },
    ]);
  });

  it('raises rather than reporting an empty assignment list when a query fails', async () => {
    fromMock.mockImplementation((tableName: string) => {
      if (tableName === 'registrations') {
        return awaitableChain({
          data: [
            {
              id: 'reg-1',
              tournament_id: 't-1',
              tournaments: { id: 't-1', name: 'Longsword', event_id: 'event-1' },
            },
          ],
          error: null,
        });
      }
      if (tableName === 'vw_tournament_query_matches') {
        return awaitableChain({
          data: null,
          error: { message: 'column vw_tournament_query_matches.nope does not exist' },
        });
      }
      return awaitableChain({ data: [], error: null });
    });

    await expect(service.getEventAssignments('event-1', 'person-1')).rejects.toMatchObject({
      response: expect.objectContaining({
        message: expect.stringContaining('does not exist'),
      }),
    });
  });

  it('flags hasBlockingMatch when the person is the referee on a running match', async () => {
    fromMock.mockImplementation((tableName: string) => {
      if (tableName === 'registrations') {
        return awaitableChain({
          data: [
            {
              id: 'reg-2',
              tournament_id: 't-1',
              tournaments: { id: 't-1', name: 'Sabre', event_id: 'event-1' },
            },
          ],
          error: null,
        });
      }
      if (tableName === 'pool_members') return awaitableChain({ data: [], error: null });
      if (tableName === 'bracket_slots') return awaitableChain({ data: [], error: null });
      if (tableName === 'vw_tournament_query_matches')
        return awaitableChain({ data: [], error: null });
      // The duty is read by the GLOBAL person (0063); matches.referee_id is gone (0209).
      if (tableName === 'persons') {
        return awaitableChain({ data: { global_person_id: 'gp-1' }, error: null });
      }
      if (tableName === 'referee_assignments') {
        // One bout duty on a running match. The tournament arrives through the
        // `phases` EMBED — there is no matches.tournament_id.
        return awaitableChain({
          data: [
            {
              id: 'ra-live',
              scope_type: 'match',
              pool_id: null,
              match_id: 'm-ref-live',
              role: 'arbitre_declarant',
              pools: null,
              matches: {
                id: 'm-ref-live',
                match_number_label: 'SBR-P1-M2',
                status: 'running',
                phases: { tournament_id: 't-1', tournaments: { id: 't-1', name: 'Sabre' } },
              },
            },
          ],
          error: null,
        });
      }
      return awaitableChain({ data: null, error: null });
    });

    const report = await service.getEventAssignments('event-1', 'person-1');
    // No read of the dropped column survives.
    expect(fromMock.mock.calls.map(([table]) => table)).not.toContain('matches');

    expect(report.hasBlockingMatch).toBe(true);
    expect(report.blockingMatches).toContainEqual({
      matchId: 'm-ref-live',
      label: 'SBR-P1-M2',
      status: 'running',
      reason: 'referee',
    });
  });

  it('scopes the report to one tournament when tournamentId is provided', async () => {
    fromMock.mockImplementation((tableName: string) => {
      if (tableName === 'registrations') {
        // Person has regs in t-1 and t-2; the tournamentId filter
        // should drop t-2 entirely.
        return awaitableChain({
          data: [
            {
              id: 'reg-A',
              tournament_id: 't-1',
              tournaments: { id: 't-1', name: 'Longsword', event_id: 'event-1' },
            },
          ],
          error: null,
        });
      }
      if (tableName === 'pool_members') return awaitableChain({ data: [], error: null });
      if (tableName === 'bracket_slots') return awaitableChain({ data: [], error: null });
      if (tableName === 'vw_tournament_query_matches')
        return awaitableChain({ data: [], error: null });
      if (tableName === 'matches') return awaitableChain({ data: [], error: null });
      if (tableName === 'referee_assignments') return awaitableChain({ data: [], error: null });
      return awaitableChain({ data: null, error: null });
    });

    const report = await service.getEventAssignments('event-1', 'person-1', 't-1');

    // Whatever the report contains, every entry should be in t-1.
    for (const entry of [
      ...report.pools,
      ...report.bracketSlots,
      ...report.matchesAsFighter,
      ...report.matchesAsReferee,
    ]) {
      expect(entry.tournamentId).toBe('t-1');
    }
    expect(report.hasBlockingMatch).toBe(false);
  });
});

describe('AssignmentsService.forceDeleteRegistration', () => {
  let service: AssignmentsService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AssignmentsService(mockSupabase as never);
  });

  it('deletes scheduled matches and the registration when no blocking match exists', async () => {
    const callLog: Array<{ table: string; op: 'delete' | 'select' }> = [];

    fromMock.mockImplementation((tableName: string) => {
      callLog.push({ table: tableName, op: 'select' });
      // Stage 1: loadRegistration → returns the reg + tournament for the
      // force-delete guard's getEventAssignments call.
      if (tableName === 'registrations') {
        const chain = awaitableChain({
          data: [
            {
              id: 'reg-1',
              person_id: 'person-1',
              tournament_id: 't-1',
              tournaments: { id: 't-1', name: 'Longsword', event_id: 'event-1' },
            },
          ],
          error: null,
        });
        // Also serve loadRegistration's single-row read shape.
        chain.maybeSingle.mockResolvedValue({
          data: {
            id: 'reg-1',
            person_id: 'person-1',
            tournament_id: 't-1',
            tournaments: { id: 't-1', name: 'Longsword', event_id: 'event-1' },
          },
          error: null,
        });
        // Mock the delete chain too.
        chain.delete = vi.fn().mockReturnValue(
          Object.assign(Promise.resolve({ data: null, error: null }), {
            eq: vi.fn().mockReturnThis(),
          }),
        );
        return chain;
      }
      if (tableName === 'pool_members') return awaitableChain({ data: [], error: null });
      if (tableName === 'bracket_slots') return awaitableChain({ data: [], error: null });
      if (tableName === 'vw_tournament_query_matches') {
        return awaitableChain({
          data: [
            {
              match_id: 'm-scheduled',
              match_number_label: 'L1-PA-M1',
              status: 'scheduled',
              tournament_id: 't-1',
              red_registration_id: 'reg-1',
              blue_registration_id: 'other',
            },
          ],
          error: null,
        });
      }
      if (tableName === 'matches') {
        callLog.push({ table: tableName, op: 'delete' });
        const chain = awaitableChain({ data: null, error: null });
        chain.delete = vi.fn().mockReturnValue(
          Object.assign(Promise.resolve({ data: null, error: null }), {
            in: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
          }),
        );
        return chain;
      }
      if (tableName === 'referee_assignments') return awaitableChain({ data: [], error: null });
      return awaitableChain({ data: null, error: null });
    });

    await expect(service.forceDeleteRegistration('reg-1')).resolves.toBeUndefined();
  });

  it('throws ConflictException with blockingMatches when the registration has a completed match', async () => {
    fromMock.mockImplementation((tableName: string) => {
      if (tableName === 'registrations') {
        const chain = awaitableChain({
          data: [
            {
              id: 'reg-1',
              person_id: 'person-1',
              tournament_id: 't-1',
              tournaments: { id: 't-1', name: 'Longsword', event_id: 'event-1' },
            },
          ],
          error: null,
        });
        chain.maybeSingle.mockResolvedValue({
          data: {
            id: 'reg-1',
            person_id: 'person-1',
            tournament_id: 't-1',
            tournaments: { id: 't-1', name: 'Longsword', event_id: 'event-1' },
          },
          error: null,
        });
        return chain;
      }
      if (tableName === 'pool_members') return awaitableChain({ data: [], error: null });
      if (tableName === 'bracket_slots') return awaitableChain({ data: [], error: null });
      if (tableName === 'vw_tournament_query_matches') {
        return awaitableChain({
          data: [
            {
              match_id: 'm-done',
              match_number_label: 'L1-PA-M5',
              status: 'completed',
              tournament_id: 't-1',
              red_registration_id: 'reg-1',
              blue_registration_id: 'other',
            },
          ],
          error: null,
        });
      }
      if (tableName === 'matches') return awaitableChain({ data: [], error: null });
      if (tableName === 'referee_assignments') return awaitableChain({ data: [], error: null });
      return awaitableChain({ data: null, error: null });
    });

    await expect(service.forceDeleteRegistration('reg-1')).rejects.toMatchObject({
      response: expect.objectContaining({
        message: expect.stringContaining('completed'),
      }),
    });
  });
});

describe('AssignmentsService.forceDeletePersonInEvent', () => {
  let service: AssignmentsService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AssignmentsService(mockSupabase as never);
  });

  it('throws ConflictException when the person has any blocking match in the event', async () => {
    fromMock.mockImplementation((tableName: string) => {
      if (tableName === 'registrations') {
        return awaitableChain({
          data: [
            {
              id: 'reg-A',
              tournament_id: 't-A',
              tournaments: { id: 't-A', name: 'Longsword', event_id: 'event-1' },
            },
          ],
          error: null,
        });
      }
      if (tableName === 'pool_members') return awaitableChain({ data: [], error: null });
      if (tableName === 'bracket_slots') return awaitableChain({ data: [], error: null });
      if (tableName === 'vw_tournament_query_matches') {
        return awaitableChain({
          data: [
            {
              match_id: 'm-done',
              match_number_label: 'L1-PA-M5',
              status: 'completed',
              tournament_id: 't-A',
              red_registration_id: 'reg-A',
              blue_registration_id: 'other',
            },
          ],
          error: null,
        });
      }
      if (tableName === 'matches') return awaitableChain({ data: [], error: null });
      if (tableName === 'referee_assignments') return awaitableChain({ data: [], error: null });
      return awaitableChain({ data: null, error: null });
    });

    await expect(service.forceDeletePersonInEvent('person-1', 'event-1')).rejects.toMatchObject({
      response: expect.objectContaining({
        message: expect.stringContaining('completed'),
      }),
    });
  });

  it("also clears the person's referee duties, and touches no matches.referee_id (0209)", async () => {
    const deletedFrom: string[] = [];
    const matchUpdates: string[] = [];

    fromMock.mockImplementation((tableName: string) => {
      if (tableName === 'registrations') {
        return awaitableChain({
          data: [
            {
              id: 'reg-A',
              tournament_id: 't-A',
              tournaments: { id: 't-A', name: 'Longsword', event_id: 'event-1' },
            },
          ],
          error: null,
        });
      }
      if (tableName === 'pool_members') return awaitableChain({ data: [], error: null });
      if (tableName === 'bracket_slots') return awaitableChain({ data: [], error: null });
      if (tableName === 'vw_tournament_query_matches')
        return awaitableChain({ data: [], error: null });
      if (tableName === 'matches') {
        // Person refereed a scheduled match (not blocking).
        const chain = awaitableChain({
          data: [
            {
              id: 'm-ref-future',
              match_number_label: 'SBR-P1-M9',
              status: 'scheduled',
              tournament_id: 't-A',
            },
          ],
          error: null,
        });
        // The column is gone: nothing may write a bout to clear it.
        chain.update = vi.fn((patch: unknown) => {
          matchUpdates.push(JSON.stringify(patch));
          return Object.assign(Promise.resolve({ data: null, error: null }), {
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
          });
        });
        chain.delete = vi.fn(() => {
          deletedFrom.push('matches');
          return Object.assign(Promise.resolve({ data: null, error: null }), {
            in: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
          });
        });
        return chain;
      }
      if (tableName === 'referee_assignments') {
        // Person also has a match-scoped referee assignment that needs
        // to disappear when they're force-deleted.
        const chain = awaitableChain({
          data: [
            {
              id: 'ra-1',
              scope_type: 'match',
              pool_id: null,
              match_id: 'm-ref-future',
              role: 'arbitre_declarant',
              pools: null,
              // The tournament hangs off `phases`, mirroring the pool branch —
              // `matches` has neither a tournament_id nor a tournaments FK.
              matches: {
                id: 'm-ref-future',
                match_number_label: 'SBR-P1-M9',
                status: 'scheduled',
                phases: { tournament_id: 't-A', tournaments: { id: 't-A', name: 'Longsword' } },
              },
            },
          ],
          error: null,
        });
        chain.delete = vi.fn(() => {
          deletedFrom.push('referee_assignments');
          return Object.assign(Promise.resolve({ data: null, error: null }), {
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
          });
        });
        return chain;
      }
      if (tableName === 'persons') {
        // The duty read resolves the event person to the global person duties carry.
        const chain = awaitableChain({ data: { global_person_id: 'gp-1' }, error: null });
        chain.delete = vi.fn(() => {
          deletedFrom.push('persons');
          return Object.assign(Promise.resolve({ data: null, error: null }), {
            eq: vi.fn().mockReturnThis(),
          });
        });
        return chain;
      }
      return awaitableChain({ data: null, error: null });
    });

    await service.forceDeletePersonInEvent('person-1', 'event-1');

    expect(deletedFrom).toContain('referee_assignments');
    expect(deletedFrom).toContain('persons');
    expect(matchUpdates).toEqual([]);
  });
});

describe('BLOCKING_MATCH_STATUSES', () => {
  // The blocking set is the operational contract — every consumer
  // mirrors this list, so pin it here.
  it('contains exactly running/paused/completed/forfeit/disqualified', () => {
    expect([...BLOCKING_MATCH_STATUSES].sort()).toEqual(
      ['completed', 'disqualified', 'forfeit', 'paused', 'running'].sort(),
    );
  });
});
