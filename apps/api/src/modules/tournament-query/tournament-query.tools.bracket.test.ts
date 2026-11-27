import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TournamentQueryToolsService } from './tournament-query.tools.service';
import {
  awaitableChain,
  M1,
  M2,
  M3,
  poolBout,
  REG_ADA,
  REG_GRACE_H,
  tournament,
  uuid,
} from './tournament-query.tools.fixtures';

const summariesMock = vi.hoisted(() => vi.fn());
vi.mock('../matches/match-summaries', () => ({ matchSummaries: summariesMock }));

const fromMock = vi.fn();
const M4 = uuid(34);
const TEAM_RED = uuid(51);
const TEAM_BLUE = uuid(52);

// A team side is a team id; every Registration column of a team bout is null (0284).
const teamBout = (matchId: string, extra = {}) => ({
  ...poolBout(matchId, '', ''),
  phase_type: 'single_elim',
  pool_id: null,
  pool_name: null,
  bracket_round: 1,
  red_registration_id: null,
  blue_registration_id: null,
  winner_registration_id: null,
  red_team_id: TEAM_RED,
  blue_team_id: TEAM_BLUE,
  winner_team_id: null,
  red_name: 'Les Lions',
  blue_name: 'Les Ours',
  ...extra,
});

describe('TournamentQueryToolsService · get_bracket_status names the real winner', () => {
  let service: TournamentQueryToolsService;
  let matchesChain: ReturnType<typeof awaitableChain>;

  beforeEach(() => {
    vi.clearAllMocks();
    summariesMock.mockResolvedValue(new Map());
    const rows = [
      teamBout(M1, { status: 'scheduled', red_score: 0, blue_score: 0 }),
      teamBout(M2, { red_score: 1, blue_score: 3, winner_team_id: TEAM_BLUE }),
      teamBout(M4, { red_score: 4, blue_score: 2, winner_team_id: TEAM_RED }),
      {
        ...poolBout(M3, REG_ADA, REG_GRACE_H),
        phase_type: 'single_elim',
        bracket_round: 2,
        winner_registration_id: REG_GRACE_H,
      },
    ];
    matchesChain = awaitableChain({ data: rows, error: null });
    fromMock.mockImplementation((tableName: string) =>
      tableName === 'vw_tournament_query_matches'
        ? matchesChain
        : awaitableChain({ data: [], error: null }),
    );
    service = new TournamentQueryToolsService(
      { service: { from: fromMock } } as never,
      { getPoolStandings: vi.fn() } as never,
    );
  });

  it('a team bout not decided has no winner, a decided one names the team that won', async () => {
    const result = await service.execute(tournament, 'get_bracket_status', {});

    expect(result.rows?.map((row) => [row['Fighters'], row['Winner']])).toEqual([
      ['Les Lions vs Les Ours', ''],
      ['Les Lions vs Les Ours', 'Les Ours'],
      ['Les Lions vs Les Ours', 'Les Lions'],
      ['Ada Lovelace vs Grace Hopper', 'Grace Hopper'],
    ]);
    const spies = matchesChain as unknown as Record<string, ReturnType<typeof vi.fn>>;
    expect(spies['select']).toHaveBeenCalledWith('*');
  });
});
