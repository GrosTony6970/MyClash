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

describe('TournamentQueryToolsService · the doubles ceiling', () => {
  let service: TournamentQueryToolsService;

  // Three bouts between the same pair, one per ceiling reason. Only the first
  // is a loss for both; the draw belongs in neither column and the
  // result-stands bout names a real winner.
  const matchRows = [
    {
      tournament_id: 't-1',
      match_id: 'm-1',
      phase_type: 'pool',
      pool_name: 'Pool A',
      status: 'completed',
      red_registration_id: 'r-1',
      blue_registration_id: 'r-2',
      red_name: 'Red One',
      blue_name: 'Blue Two',
      red_score: 0,
      blue_score: 0,
      winner_registration_id: null,
      end_reason: 'max_doubles',
    },
    {
      tournament_id: 't-1',
      match_id: 'm-2',
      phase_type: 'pool',
      pool_name: 'Pool A',
      status: 'completed',
      red_registration_id: 'r-1',
      blue_registration_id: 'r-2',
      red_name: 'Red One',
      blue_name: 'Blue Two',
      red_score: 0,
      blue_score: 0,
      winner_registration_id: null,
      end_reason: 'max_doubles_draw',
    },
    {
      tournament_id: 't-1',
      match_id: 'm-3',
      phase_type: 'pool',
      pool_name: 'Pool A',
      status: 'completed',
      red_registration_id: 'r-1',
      blue_registration_id: 'r-2',
      red_name: 'Red One',
      blue_name: 'Blue Two',
      red_score: 2,
      blue_score: 0,
      winner_registration_id: 'r-1',
      end_reason: 'max_doubles_result_stands',
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    service = new TournamentQueryToolsService(mockSupabase as never);
    fromMock.mockImplementation((tableName: string) => {
      if (tableName === 'vw_tournament_query_matches') {
        return awaitableChain({ data: matchRows, error: null });
      }
      return awaitableChain({ data: [], error: null });
    });
  });

  it('counts a double loss as a loss, not as a bout nobody lost', async () => {
    // It has no winner, so the winner test credited neither side while the bout
    // still counted toward `Matches` — deflating the win rate the organiser is
    // shown and the one the assistant reasons from. The view carries
    // `end_reason` from migration 0193; before that it could not be seen here
    // at all.
    const red = await service.execute(tournament, 'get_fighter_stats', { fighter_id: 'r-1' });
    const blue = await service.execute(tournament, 'get_fighter_stats', { fighter_id: 'r-2' });

    // Red won m-3, lost m-1 (double loss); m-2 is a draw and counts as neither.
    expect(red.card).toMatchObject({ Matches: 3, Wins: 1, Losses: 1 });
    // Blue lost m-1 (double loss) and m-3 (red won it).
    expect(blue.card).toMatchObject({ Matches: 3, Wins: 0, Losses: 2 });
  });
});
