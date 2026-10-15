import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AssignmentsService } from './assignments.service';

/**
 * A bout with no number (one made by hand) was shown in the remove-a-fighter window by its
 * database id. Ruled 2026-10-15: its Tournament and its round. The report carries what names
 * it — from `matchSummaries`, the one builder of a bout's round — and only for such a bout.
 */
const summariesMock = vi.hoisted(() => vi.fn());
vi.mock('../matches/match-summaries', () => ({ matchSummaries: summariesMock }));

const fromMock = vi.fn();

function chain(data: unknown) {
  const result = { data, error: null };
  const link = Object.assign(Promise.resolve(result), {
    maybeSingle: vi.fn().mockResolvedValue(result),
  }) as unknown as Record<string, unknown>;
  for (const key of ['select', 'eq', 'in', 'or']) link[key] = vi.fn().mockReturnValue(link);
  return link;
}

const TABLES: Record<string, unknown> = {
  registrations: [
    {
      id: 'reg-1',
      tournament_id: 't-1',
      tournaments: { id: 't-1', name: 'Longsword Open', event_id: 'event-1' },
    },
  ],
  pool_members: [],
  bracket_slots: [],
  vw_tournament_query_matches: [
    {
      match_id: 'm-numbered',
      match_number_label: 'L1-P2-M03',
      status: 'scheduled',
      tournament_id: 't-1',
      red_registration_id: 'reg-1',
      blue_registration_id: 'x',
    },
    {
      match_id: 'm-by-hand',
      match_number_label: null,
      status: 'running',
      tournament_id: 't-1',
      red_registration_id: 'reg-1',
      blue_registration_id: 'x',
    },
  ],
  persons: { global_person_id: null },
};

describe('the round of a bout with no number', () => {
  let service: AssignmentsService;

  beforeEach(() => {
    vi.clearAllMocks();
    fromMock.mockImplementation((table: string) => chain(TABLES[table] ?? []));
    summariesMock.mockResolvedValue(
      new Map([['m-by-hand', { roundToken: null, poolName: '', phaseType: 'single_elim' }]]),
    );
    service = new AssignmentsService({ service: { from: fromMock } } as never, {} as never);
  });

  it('is read for that bout alone, and travels with it and with its blocking line', async () => {
    const report = await service.getEventAssignments('event-1', 'person-1');

    expect(summariesMock).toHaveBeenCalledTimes(1);
    expect(summariesMock.mock.calls[0]?.[1]).toEqual(['m-by-hand']);
    const round = { roundToken: null, poolName: null, phaseType: 'single_elim' };
    expect(report.matchesAsFighter).toEqual([
      {
        matchId: 'm-numbered',
        label: 'L1-P2-M03',
        status: 'scheduled',
        tournamentId: 't-1',
        tournamentName: 'Longsword Open',
      },
      {
        matchId: 'm-by-hand',
        label: '',
        status: 'running',
        tournamentId: 't-1',
        tournamentName: 'Longsword Open',
        ...round,
      },
    ]);
    expect(report.blockingMatches).toEqual([
      {
        matchId: 'm-by-hand',
        label: '',
        status: 'running',
        reason: 'fighter',
        tournamentName: 'Longsword Open',
        ...round,
      },
    ]);
  });

  // Review, 2026-10-16: the round only names a bout; a failed read must not refuse a delete.
  it('leaves the bout named by its Tournament alone when the read fails', async () => {
    summariesMock.mockRejectedValueOnce(new Error('pools: down'));

    const report = await service.getEventAssignments('event-1', 'person-1');

    expect(report.blockingMatches).toEqual([
      {
        matchId: 'm-by-hand',
        label: '',
        status: 'running',
        reason: 'fighter',
        tournamentName: 'Longsword Open',
      },
    ]);
  });

  it('is not read when every bout has its number', async () => {
    const numbered = (TABLES['vw_tournament_query_matches'] as unknown[]).slice(0, 1);
    fromMock.mockImplementation((table: string) =>
      chain(table === 'vw_tournament_query_matches' ? numbered : (TABLES[table] ?? [])),
    );

    await service.getEventAssignments('event-1', 'person-1');

    expect(summariesMock).not.toHaveBeenCalled();
  });
});
