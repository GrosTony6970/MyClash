import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AssignmentsService } from './assignments.service';

/**
 * What the remove-a-fighter window calls each bout, from `matchSummaries`, the one builder of
 * a bout's name. A bout with a number reads by its code (`LSW-P2-M03`), never by its stored
 * label (`L1-P2-M03`). A bout with no number (one made by hand) was shown by its database id;
 * ruled 2026-10-15: its Tournament and its round.
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

describe('the name of each bout in the remove-a-fighter window', () => {
  let service: AssignmentsService;

  beforeEach(() => {
    vi.clearAllMocks();
    fromMock.mockImplementation((table: string) => chain(TABLES[table] ?? []));
    summariesMock.mockResolvedValue(
      new Map([
        [
          'm-numbered',
          { roundCode: 'LSW-P2-M03', roundToken: null, poolName: 'Pool 2', phaseType: 'pool' },
        ],
        [
          'm-by-hand',
          { roundCode: 'LSW-B', roundToken: null, poolName: '', phaseType: 'single_elim' },
        ],
      ]),
    );
    service = new AssignmentsService({ service: { from: fromMock } } as never, {} as never);
  });

  it('is read once for every bout: a numbered one takes its code, one with none its round', async () => {
    const report = await service.getEventAssignments('event-1', 'person-1');

    expect(summariesMock).toHaveBeenCalledTimes(1);
    expect(summariesMock.mock.calls[0]?.[1]).toEqual(['m-numbered', 'm-by-hand']);
    const round = { roundToken: null, poolName: null, phaseType: 'single_elim' };
    expect(report.matchesAsFighter).toEqual([
      {
        matchId: 'm-numbered',
        label: 'LSW-P2-M03',
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

  // Review, 2026-10-16: the name only names a bout; a failed read must not refuse a delete.
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
});
