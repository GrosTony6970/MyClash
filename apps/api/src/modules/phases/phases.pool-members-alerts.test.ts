/**
 * A Fighter added to a Pool or removed from it: the Pool's bouts are deleted and made again, with
 * no time. A locked referee duty on that Pool starts at its earliest placed bout, so it has no
 * start any more, and its "your duty starts soon" must not ring at the old minute (operator
 * ruling 221). The Pool is named to the alert seam after its bouts changed.
 *
 * The seeded double applies no write: `pool_members` is seeded as it reads AFTER the change.
 */
import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { mockSupabase, writesTo, type TableSeed } from '../../common/testing/supabase-chain';
import { PhasesService } from './phases.service';

const pool = (id: string) => ({
  id,
  name: 'Pool 1',
  phase_id: 'phase-1',
  sort_order: 1,
  phases: {
    id: 'phase-1',
    tournament_id: 't-1',
    tournaments: { event_id: 'event-1', weapon: 'longsword', events: { organization_id: 'org-1' } },
  },
});
const member = (registrationId: string, seed: number, poolId = 'pool-1') => ({
  id: `pm-${registrationId}`,
  pool_id: poolId,
  registration_id: registrationId,
  seed,
  pools: { phase_id: 'phase-1', phases: { tournament_id: 't-1' } },
});
const PHASES = {
  rows: [
    {
      id: 'phase-1',
      tournaments: { ruleset_code: 'TF_v1', ruleset_version: '1.0.0', ruleset_content_hash: null },
    },
  ],
};

function makeService(seed: Record<string, TableSeed>) {
  const supabase = mockSupabase({ pools: { rows: [pool('pool-0'), pool('pool-1')] }, ...seed });
  /** The writes of bouts that had landed each time the seam was asked. */
  const boutWritesWhenAsked: string[][] = [];
  const matchAlerts = {
    refresh: vi.fn().mockResolvedValue(undefined),
    refreshPools: vi.fn(() => {
      boutWritesWhenAsked.push(writesTo(supabase, 'matches').map((write) => write.op));
      return Promise.resolve();
    }),
  };
  const service = new PhasesService(
    supabase as never,
    { placeMatches: vi.fn() } as never,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    matchAlerts as never,
  );
  // Who may edit a Pool, and until when, is `phases.service.test.ts`'s.
  const doors = service as unknown as {
    assertPoolEditAuth: () => Promise<{ tournamentId: string }>;
    assertPoolEditable: () => Promise<void>;
  };
  vi.spyOn(doors, 'assertPoolEditAuth').mockResolvedValue({ tournamentId: 't-1' });
  vi.spyOn(doors, 'assertPoolEditable').mockResolvedValue(undefined);
  return { service, supabase, matchAlerts, boutWritesWhenAsked };
}

describe("a Pool's members change: its referees' alerts follow (ruling 221)", () => {
  it('names the Pool once its bouts are deleted, when one Fighter is left and no bout is made', async () => {
    const { service, matchAlerts, boutWritesWhenAsked } = makeService({
      pool_members: { rows: [member('reg-2', 1)] },
      matches: { rows: [{ id: 'old-1', pool_id: 'pool-1' }] },
    });

    await service.removePoolMember('pool-1', 'reg-1', 'user-1');

    expect(matchAlerts.refreshPools.mock.calls).toEqual([[['pool-1']]]);
    expect(boutWritesWhenAsked).toEqual([['delete']]);
  });

  it('names the Pool once its new bouts are in', async () => {
    const { service, matchAlerts, boutWritesWhenAsked } = makeService({
      pool_members: { rows: [member('reg-2', 1), member('reg-3', 2)] },
      matches: { rows: [{ id: 'old-1', pool_id: 'pool-1' }] },
      phases: PHASES,
    });

    await service.removePoolMember('pool-1', 'reg-1', 'user-1');

    expect(matchAlerts.refreshPools.mock.calls).toEqual([[['pool-1']]]);
    expect(boutWritesWhenAsked).toEqual([['delete', 'insert']]);
  });

  it('names both Pools when a Fighter moves from one to the other', async () => {
    const { service, matchAlerts } = makeService({
      registrations: { rows: [{ id: 'reg-1', status: 'registered' }] },
      // reg-1 sits in pool-0 and moves to pool-1, which holds reg-2.
      pool_members: { rows: [member('reg-1', 1, 'pool-0'), member('reg-2', 1)] },
      matches: { rows: [] },
    });

    await service.addPoolMember('pool-1', 'reg-1', 'user-1');

    expect(matchAlerts.refreshPools.mock.calls).toEqual([[['pool-1']], [['pool-0']]]);
  });

  it('still names the Pool when its bouts are deleted and the new ones are refused', async () => {
    const { service, matchAlerts } = makeService({
      pool_members: { rows: [member('reg-2', 1), member('reg-3', 2)] },
      // The delete lands, the insert is refused.
      matches: [
        { data: null, error: null },
        { data: null, error: { message: 'boom' } },
      ],
      phases: PHASES,
    });

    await expect(service.removePoolMember('pool-1', 'reg-1', 'user-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );

    expect(matchAlerts.refreshPools.mock.calls).toEqual([[['pool-1']]]);
  });

  it('never names the bouts to the bout door: the old ones are gone, the new ones have no time', async () => {
    const { service, matchAlerts } = makeService({
      pool_members: { rows: [member('reg-2', 1), member('reg-3', 2)] },
      matches: { rows: [{ id: 'old-1', pool_id: 'pool-1' }] },
      phases: PHASES,
    });

    await service.removePoolMember('pool-1', 'reg-1', 'user-1');

    expect(matchAlerts.refresh).not.toHaveBeenCalled();
  });
});
