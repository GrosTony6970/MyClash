import { describe, expect, it, vi } from 'vitest';
import type { PoolStandingsRow } from '@myclash/types/pool-standings';
import { mockSupabase } from '../../common/testing/supabase-chain';
import { EventStatsService } from './event-stats.service';

/**
 * The statistics page's standings are the pool-standings rows (`PoolStandingsRow`, one owner). A
 * team row keeps its kind, colour and logo, and every row keeps its status, through the detail.
 */

const TEAM: PoolStandingsRow = {
  rank: 1,
  entrantId: 'team-lyon',
  displayName: 'Lyon Blades',
  club: null,
  status: 'completed',
  stats: { V: 2 },
  kind: 'team',
  colour: 'teal',
  logoUrl: 'https://cdn/lyon.png',
};
const FIGHTER: PoolStandingsRow = {
  rank: 2,
  entrantId: 'reg-anna',
  displayName: 'Anna Roux',
  club: { id: 'c1', name: 'Lyon AMHE', abbreviation: 'LYA' },
  status: 'in_progress',
  stats: { V: 1 },
  kind: 'individual',
  colour: null,
  logoUrl: null,
};

function serviceWith(rows: PoolStandingsRow[]) {
  const db = mockSupabase({
    events: { rows: [{ id: 'e1', organization_id: 'org-1', slug: 'evt', name: 'Evt' }] },
    tournaments: { rows: [{ id: 't1', event_id: 'e1' }] },
  });
  const orgs = { assertOrgRole: vi.fn().mockResolvedValue(undefined) };
  const stats = { getFighterStats: vi.fn().mockResolvedValue({ fighters: [], afterblow: null }) };
  const poolStandings = {
    getPoolStandings: vi.fn().mockResolvedValue({
      rulesetCode: 'TF_v1',
      rulesetVersion: '1.0.0',
      columns: [],
      rows,
    }),
  };
  return new EventStatsService(
    db as never,
    orgs as never,
    {} as never,
    stats as never,
    poolStandings as never,
  );
}

describe('the tournament statistics detail', () => {
  it("passes each row's status, kind, colour and logo through", async () => {
    const service = serviceWith([
      { ...TEAM, decidingTiebreak: null },
      { ...FIGHTER, decidingTiebreak: null },
    ]);

    const detail = await service.getTournamentDetail('e1', 't1', 'user-1');

    expect(detail.standings.rows).toEqual([TEAM, FIGHTER]);
  });
});
