import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TournamentQueryToolsService } from './tournament-query.tools.service';
import type { TournamentContext } from './tournament-query.types';

// Same per-table dispatch pattern as the other API service tests: one fromMock
// reused, branched by tableName.

const fromMock = vi.fn();
const mockSupabase = { service: { from: fromMock } };

function awaitableChain(result: { data: unknown; error: unknown }) {
  const chain = Object.assign(Promise.resolve(result), {}) as Record<string, unknown> &
    Promise<typeof result>;
  for (const key of ['select', 'eq', 'in', 'or', 'order', 'limit']) {
    (chain as unknown as Record<string, unknown>)[key] = vi.fn().mockReturnValue(chain);
  }
  return chain;
}

const tournament: TournamentContext = {
  tournamentId: 't-1',
  eventId: 'event-1',
  organizationId: 'org-1',
  name: 'Longsword Open',
  weapon: 'longsword',
  weapons: ['longsword'],
  poolIds: ['pool-1'],
  liceNumbers: [1],
  divisions: [],
};

// The projection vw_tournament_query_referees actually has, confirmed against a
// replayed database: 0063 replaced user_id with person_id. Nothing here may
// carry a user_id field — a fixture that invents one cannot catch the bug that
// made this tool return "no assignments" for every judge.
const refereeRows = [
  {
    tournament_id: 't-1',
    event_id: 'event-1',
    person_id: 'gp-jean',
    judge_name: 'Jean Dupont',
    pool_id: 'pool-1',
    pool_name: 'Pool A',
    match_id: 'm-1',
    role: 'arbitre_declarant',
    status: 'confirmed',
  },
  {
    tournament_id: 't-1',
    event_id: 'event-1',
    person_id: 'gp-jean',
    judge_name: 'Jean Dupont',
    pool_id: 'pool-2',
    pool_name: 'Pool B',
    match_id: 'm-2',
    role: 'arbitre_assesseur',
    status: 'confirmed',
  },
  {
    tournament_id: 't-1',
    event_id: 'event-1',
    person_id: 'gp-marie',
    judge_name: 'Marie Martin',
    pool_id: 'pool-1',
    pool_name: 'Pool A',
    match_id: null,
    role: 'arbitre_table',
    status: 'confirmed',
  },
];

describe('TournamentQueryToolsService · get_judge_stats', () => {
  let service: TournamentQueryToolsService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new TournamentQueryToolsService(mockSupabase as never);
    fromMock.mockImplementation((tableName: string) => {
      if (tableName === 'vw_tournament_query_referees') {
        return awaitableChain({ data: refereeRows, error: null });
      }
      return awaitableChain({ data: [], error: null });
    });
  });

  it('aggregates a judge matched by person id', async () => {
    const result = await service.execute(tournament, 'get_judge_stats', { judge_id: 'gp-jean' });

    expect(result.title).toBe('Judge stats for Jean Dupont');
    expect(result.card).toEqual({ Assignments: 2, Pools: 2, Matches: 2 });
  });

  it('aggregates a judge matched by name, which is the only id the model ever sees', async () => {
    const result = await service.execute(tournament, 'get_judge_stats', {
      judge_id: 'Marie Martin',
    });

    expect(result.title).toBe('Judge stats for Marie Martin');
    expect(result.card).toEqual({ Assignments: 1, Pools: 1, Matches: 0 });
  });

  it('does not fall back to every judge when the id is blank', async () => {
    // A blank filter must not become "matches everyone": contains('') is true
    // for every row.
    const result = await service.execute(tournament, 'get_judge_stats', { judge_id: '   ' });

    expect(result.render_hint).toBe('empty');
    expect(result.metadata?.notes).toContain('No judge assignments found');
    expect(result.card).toBeUndefined();
  });

  it('reports nothing for a judge who is not in this event', async () => {
    const result = await service.execute(tournament, 'get_judge_stats', { judge_id: 'gp-nobody' });

    expect(result.render_hint).toBe('empty');
    expect(result.metadata?.notes).toContain('No judge assignments found');
  });
});
