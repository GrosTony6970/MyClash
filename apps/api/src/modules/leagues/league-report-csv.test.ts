import { describe, expect, it, vi } from 'vitest';
import { LeaguesController } from './leagues.controller';
import { LeaguesService } from './leagues.service';

type Standings = Awaited<ReturnType<LeaguesService['standings']>>;

/** The report reaches nothing but `this.standings`, so nothing else is wired. */
function controllerReporting(rows: unknown[]): LeaguesController {
  const service = new LeaguesService(
    null as never,
    null as never,
    null as never,
    undefined as never,
  );
  vi.spyOn(service, 'standings').mockResolvedValue({ league: {}, rows } as unknown as Standings);
  return new LeaguesController(service, null as never);
}

const LEA = {
  ranking_group_key: 'open',
  rank: 1,
  global_person_id: 'gp-1',
  global_persons: { display_name: 'Léa Martin' },
  total_points: 42,
  participation_count: 2,
  medal_count: 1,
  double_hit_average: '1.5',
};

const HEADER =
  'ranking_group;league_rank;fighter;total_points;participation_count;medal_count;double_hit_average';

describe('the season report CSV', () => {
  it('writes the French Excel file when asked: ;, and the average as 1,5', async () => {
    const csv = await controllerReporting([LEA]).finalReportCsv('league-1', { csv: 'excel-fr' });
    expect(csv).toBe(`\uFEFF${HEADER}\r\nopen;1;Léa Martin;42;2;1;1,5\r\n`);
  });

  it('writes the standard file otherwise, with the byte-order mark too', async () => {
    const csv = await controllerReporting([LEA]).finalReportCsv('league-1', { csv: 'standard' });
    expect(csv).toBe(`\uFEFF${HEADER.replaceAll(';', ',')}\r\nopen,1,Léa Martin,42,2,1,1.5\r\n`);
  });

  it('names a fighter with no profile name by the profile, and makes a formula harmless', async () => {
    const csv = await controllerReporting([
      { ...LEA, global_persons: null },
      { ...LEA, rank: 2, global_persons: { display_name: '=cmd' } },
    ]).finalReportCsv('league-1', { csv: 'standard' });
    expect(csv.split('\r\n').slice(1, 3)).toEqual([
      'open,1,gp-1,42,2,1,1.5',
      `open,2,"'=cmd",42,2,1,1.5`,
    ]);
  });
});
