/**
 * Force-deleting a Fighter deletes their unplayed bouts. A locked referee duty on a Pool starts
 * at the Pool's earliest placed bout, and that bout may be one of them: the duty's "your duty
 * starts soon" must follow (operator ruling 221). The deleted bouts cannot be named to the alert
 * seam, so their Pools are, and they come back from the delete itself.
 *
 * The assignment report is `assignments.service.test.ts`'s; it is stubbed here to say which
 * bouts go. m-1 and m-2 sit in Pool A, m-3 in no Pool; m-9 is a bout of Pool Z that stays.
 */
import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import {
  filtersFor,
  mockSupabase,
  selectsFor,
  writesTo,
  type TableSeed,
} from '../../common/testing/supabase-chain';
import { AssignmentsService } from './assignments.service';

const REG_EVENT = { id: 't-1', name: 'LS', event_id: 'event-1' };
const BOUTS = {
  rows: [
    { id: 'm-1', pool_id: 'pool-a' },
    { id: 'm-2', pool_id: 'pool-a' },
    { id: 'm-3', pool_id: null },
    { id: 'm-9', pool_id: 'pool-z' },
  ],
};

function makeService(boutsThatGo: string[], matches: TableSeed = BOUTS) {
  const supabase = mockSupabase({
    // No lock row: the board is unlocked, and the lock is another file's.
    referee_assignments: { rows: [] },
    registrations: {
      rows: [{ id: 'reg-1', person_id: 'person-1', tournament_id: 't-1', tournaments: REG_EVENT }],
    },
    matches,
    persons: { data: null, error: null },
  });
  /** The writes of bouts that had landed when the seam was asked. */
  const boutWritesWhenAsked: string[][] = [];
  const matchAlerts = {
    refreshPools: vi.fn(() => {
      boutWritesWhenAsked.push(writesTo(supabase, 'matches').map((write) => write.op));
      return Promise.resolve();
    }),
  };
  const service = new AssignmentsService(supabase as never, matchAlerts as never);
  vi.spyOn(service, 'getEventAssignments').mockResolvedValue({
    hasBlockingMatch: false,
    blockingMatches: [],
    matchesAsFighter: boutsThatGo.map((matchId) => ({ matchId })),
    refereeAssignments: [],
  } as never);
  return { service, supabase, matchAlerts, boutWritesWhenAsked };
}

type Door = (service: AssignmentsService) => Promise<void>;
const DOORS: Array<[string, Door]> = [
  ['a person', (service) => service.forceDeletePersonInEvent('person-1', 'event-1')],
  ['one registration', (service) => service.forceDeleteRegistration('reg-1')],
];

describe("force-deleting a Fighter: the referees' alerts of their Pools follow (ruling 221)", () => {
  it.each(DOORS)('%s: names the Pools of the deleted bouts, after the delete', async (_l, door) => {
    const { service, supabase, matchAlerts, boutWritesWhenAsked } = makeService([
      'm-1',
      'm-2',
      'm-3',
    ]);

    await door(service);

    // As the delete hands them back: the seam names each Pool once and drops the bout of no Pool.
    expect(matchAlerts.refreshPools.mock.calls).toEqual([[['pool-a', 'pool-a', null]]]);
    expect(boutWritesWhenAsked).toEqual([['delete']]);
    // PostgREST hands back nothing from a delete unless asked: the projection is the contract.
    expect(selectsFor(supabase.from, 'matches')).toEqual(['pool_id']);
    expect(filtersFor(supabase.from, 'matches', 'in')).toEqual([['id', ['m-1', 'm-2', 'm-3']]]);
  });

  it.each(DOORS)('%s: asks nothing and deletes no bout when no bout goes', async (_l, door) => {
    const { service, supabase, matchAlerts } = makeService([]);

    await door(service);

    expect(matchAlerts.refreshPools).not.toHaveBeenCalled();
    expect(writesTo(supabase, 'matches')).toEqual([]);
  });

  it.each(DOORS)('%s: a refused delete of the bouts asks nothing', async (_l, door) => {
    const { service, matchAlerts } = makeService(['m-1'], {
      data: null,
      error: { message: 'boom' },
    });

    await expect(door(service)).rejects.toBeInstanceOf(BadRequestException);

    expect(matchAlerts.refreshPools).not.toHaveBeenCalled();
  });
});
