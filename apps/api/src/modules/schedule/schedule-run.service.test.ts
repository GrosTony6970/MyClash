import { beforeEach, describe, expect, it } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { filtersFor, queriedTables, selectsFor } from '../../common/testing/supabase-chain';
import {
  EVENT,
  MEMBERSHIP_SELECT,
  POOL,
  RUN_SELECT,
  iso,
  makeService,
  orgs,
  placed,
  placement,
  row,
  tables,
} from './schedule-run.fixtures';

/**
 * The run window's save, on the seeded double with `resolveMatchLengths` and the
 * sheet read running for real. The placement owner is doubled: whether the
 * pistes accept a layout is `match-placement.override.test.ts`'s; what is
 * asserted here is the batch this service hands it.
 */

beforeEach(() => {
  orgs.assertOrgRole.mockReset().mockResolvedValue(undefined);
  placement.placeMatches.mockReset().mockResolvedValue(undefined);
});

describe('ScheduleRunService.saveRun', () => {
  it('moves the run to its new start, keeps its spacing, and sends no length', async () => {
    const { service, supabase } = makeService(
      tables([
        row('m-1', 'L1', '10:00:00'),
        row('m-2', 'L1', '10:07:10'),
        row('m-3', 'L2', '10:00:00'),
      ]),
    );

    const result = await service.saveRun(
      EVENT,
      { matchIds: ['m-1', 'm-2', 'm-3'], startAt: iso('10:43:00') },
      'user-1',
    );

    // The editor bar, then membership, then the run's rows — and no sheet read
    // for a move that keeps every length.
    expect(orgs.assertOrgRole).toHaveBeenCalledWith('org-1', 'user-1', 'editor');
    expect(queriedTables(supabase.from)).toEqual(['events', 'matches', 'matches']);
    expect(selectsFor(supabase.from, 'matches')).toEqual([MEMBERSHIP_SELECT, RUN_SELECT]);
    expect(filtersFor(supabase.from, 'matches', 'in')).toEqual([
      ['id', ['m-1', 'm-2', 'm-3']],
      ['id', ['m-1', 'm-2', 'm-3']],
    ]);
    expect(placement.placeMatches).toHaveBeenCalledExactlyOnceWith(EVENT, [
      { matchId: 'm-1', liceId: 'L1', scheduledAt: iso('10:43:00') },
      { matchId: 'm-2', liceId: 'L1', scheduledAt: iso('10:50:10') },
      { matchId: 'm-3', liceId: 'L2', scheduledAt: iso('10:43:00') },
    ]);
    expect(result).toEqual({ placed: 3 });
  });

  it("lays the run at a typed 7 minutes plus the sheet's gap, each bout carrying 7", async () => {
    const { service } = makeService(
      tables(
        [row('m-1', 'L1', '10:00:00'), row('m-2', 'L1', '10:05:00'), row('m-3', 'L1', '10:10:00')],
        { matchGapSeconds: 30 },
      ),
    );

    await service.saveRun(
      EVENT,
      {
        matchIds: ['m-1', 'm-2', 'm-3'],
        startAt: iso('11:00:00'),
        plannedDurationOverrideMinutes: 7,
      },
      'user-1',
    );

    expect(placed()).toEqual([
      {
        matchId: 'm-1',
        liceId: 'L1',
        scheduledAt: iso('11:00:00'),
        plannedDurationOverrideMinutes: 7,
      },
      {
        matchId: 'm-2',
        liceId: 'L1',
        scheduledAt: iso('11:07:30'),
        plannedDurationOverrideMinutes: 7,
      },
      {
        matchId: 'm-3',
        liceId: 'L1',
        scheduledAt: iso('11:15:00'),
        plannedDurationOverrideMinutes: 7,
      },
    ]);
  });

  it("lays a cleared run at each bout's sheet length, each bout carrying null", async () => {
    // Every row still stores 9 minutes. A real run never mixes kinds; the pool
    // bouts on L1 and the Swiss bouts on L2 prove each bout is measured by its
    // OWN phase rather than by one length for the run.
    const stored = { planned_duration_override_minutes: 9 };
    const swiss = { ...stored, phase_id: 'phase-swiss' };
    const { service } = makeService(
      tables(
        [
          row('p-1', 'L1', '10:00:00', stored),
          row('s-1', 'L2', '10:00:00', swiss),
          row('p-2', 'L1', '10:09:00', stored),
          row('s-2', 'L2', '10:09:00', swiss),
        ],
        { poolMatchDurationMinutes: 6, swissMatchDurationMinutes: 11, matchGapSeconds: 30 },
      ),
    );

    await service.saveRun(
      EVENT,
      {
        matchIds: ['p-1', 's-1', 'p-2', 's-2'],
        startAt: iso('11:00:00'),
        plannedDurationOverrideMinutes: null,
      },
      'user-1',
    );

    const byId = Object.fromEntries(placed().map((p) => [p['matchId'], p]));
    expect(byId['p-2']).toEqual({
      matchId: 'p-2',
      liceId: 'L1',
      scheduledAt: iso('11:06:30'),
      plannedDurationOverrideMinutes: null,
    });
    expect(byId['s-2']?.['scheduledAt']).toBe(iso('11:11:30'));
    expect(placed().map((p) => p['plannedDurationOverrideMinutes'])).toEqual([
      null,
      null,
      null,
      null,
    ]);
  });

  it("breaks a Pool's run once in the middle of each piste, for the sheet's rest", async () => {
    // The operator's rule (2026-09-17): a Pool runs back to back with ONE break
    // in the middle of each piste's queue, the sheet's rest long. Four bouts on
    // one piste break after the second.
    const inPool = { pool_id: POOL };
    const { service } = makeService(
      tables(
        [
          row('m-1', 'L1', '10:00:00', inPool),
          row('m-2', 'L1', '10:05:00', inPool),
          row('m-3', 'L1', '10:10:00', inPool),
          row('m-4', 'L1', '10:15:00', inPool),
        ],
        { matchGapSeconds: 30, minRestMinutes: 12 },
      ),
    );

    await service.saveRun(
      EVENT,
      {
        matchIds: ['m-1', 'm-2', 'm-3', 'm-4'],
        startAt: iso('11:00:00'),
        plannedDurationOverrideMinutes: 7,
      },
      'user-1',
    );

    expect(placed().map((p) => p['scheduledAt'])).toEqual([
      iso('11:00:00'),
      iso('11:07:30'),
      // 11:15:00 plus the sheet's twelve minutes of rest.
      iso('11:27:00'),
      iso('11:34:30'),
    ]);
  });

  it("takes no break for a Swiss round's run, whatever rest the sheet asks for", async () => {
    // A fighter appears at most once in a Swiss or bracket round, so it runs
    // back to back. Its bouts name no Pool.
    const swiss = { phase_id: 'phase-swiss' };
    const { service } = makeService(
      tables(
        [
          row('s-1', 'L1', '10:00:00', swiss),
          row('s-2', 'L1', '10:05:00', swiss),
          row('s-3', 'L1', '10:10:00', swiss),
          row('s-4', 'L1', '10:15:00', swiss),
        ],
        { matchGapSeconds: 30, minRestMinutes: 12 },
      ),
    );

    await service.saveRun(
      EVENT,
      {
        matchIds: ['s-1', 's-2', 's-3', 's-4'],
        startAt: iso('11:00:00'),
        plannedDurationOverrideMinutes: 7,
      },
      'user-1',
    );

    expect(placed().map((p) => p['scheduledAt'])).toEqual([
      iso('11:00:00'),
      iso('11:07:30'),
      iso('11:15:00'),
      iso('11:22:30'),
    ]);
  });

  it('takes no break when the run holds bouts of two Pools', async () => {
    // The rule is a Pool's. A selection spanning two Pools is not one, and the
    // deciding row sits in the middle rather than at either end.
    const { service } = makeService(
      tables(
        [
          row('m-1', 'L1', '10:00:00', { pool_id: POOL }),
          row('m-2', 'L1', '10:05:00', { pool_id: 'pool-b' }),
          row('m-3', 'L1', '10:10:00', { pool_id: POOL }),
          row('m-4', 'L1', '10:15:00', { pool_id: POOL }),
        ],
        { matchGapSeconds: 30, minRestMinutes: 12 },
      ),
    );

    await service.saveRun(
      EVENT,
      {
        matchIds: ['m-1', 'm-2', 'm-3', 'm-4'],
        startAt: iso('11:00:00'),
        plannedDurationOverrideMinutes: 7,
      },
      'user-1',
    );

    expect(placed().map((p) => p['scheduledAt'])).toEqual([
      iso('11:00:00'),
      iso('11:07:30'),
      iso('11:15:00'),
      iso('11:22:30'),
    ]);
  });

  it("takes no break when the sheet's rest is empty, even for a Pool", async () => {
    const inPool = { pool_id: POOL };
    const { service } = makeService(
      tables(
        [
          row('m-1', 'L1', '10:00:00', inPool),
          row('m-2', 'L1', '10:05:00', inPool),
          row('m-3', 'L1', '10:10:00', inPool),
          row('m-4', 'L1', '10:15:00', inPool),
        ],
        { matchGapSeconds: 30, minRestMinutes: 0 },
      ),
    );

    await service.saveRun(
      EVENT,
      {
        matchIds: ['m-1', 'm-2', 'm-3', 'm-4'],
        startAt: iso('11:00:00'),
        plannedDurationOverrideMinutes: 7,
      },
      'user-1',
    );

    expect(placed().map((p) => p['scheduledAt'])).toEqual([
      iso('11:00:00'),
      iso('11:07:30'),
      iso('11:15:00'),
      iso('11:22:30'),
    ]);
  });

  it("moves a Pool's run without a break when no length is typed", async () => {
    // A move keeps the spacing it finds, rest included: only a re-lay decides
    // where the rest goes.
    const inPool = { pool_id: POOL };
    const { service } = makeService(
      tables(
        [
          row('m-1', 'L1', '10:00:00', inPool),
          row('m-2', 'L1', '10:05:00', inPool),
          row('m-3', 'L1', '10:10:00', inPool),
        ],
        { minRestMinutes: 12 },
      ),
    );

    await service.saveRun(
      EVENT,
      { matchIds: ['m-1', 'm-2', 'm-3'], startAt: iso('11:00:00') },
      'user-1',
    );

    expect(placed().map((p) => p['scheduledAt'])).toEqual([
      iso('11:00:00'),
      iso('11:05:00'),
      iso('11:10:00'),
    ]);
  });

  it('leaves a bout with no piste or no time out of the run', async () => {
    const { service } = makeService(
      tables([
        row('m-1', 'L1', '10:00:00'),
        row('m-2', null, null),
        row('m-3', 'L1', null),
        row('m-4', 'L1', '10:05:00'),
      ]),
    );

    await service.saveRun(
      EVENT,
      { matchIds: ['m-1', 'm-2', 'm-3', 'm-4'], startAt: iso('10:30:00') },
      'user-1',
    );

    expect(placed().map((p) => p['matchId'])).toEqual(['m-1', 'm-4']);
  });

  it('refuses a run with no placed bout, and places nothing', async () => {
    const { service } = makeService(tables([row('m-1', null, null), row('m-2', 'L1', null)]));

    await expect(
      service.saveRun(EVENT, { matchIds: ['m-1', 'm-2'], startAt: iso('10:30:00') }, 'user-1'),
    ).rejects.toThrow('This run has no placed bout. Reload the schedule.');
    expect(placement.placeMatches).not.toHaveBeenCalled();
  });

  it('reads no Match and places nothing for a caller below the editor bar', async () => {
    orgs.assertOrgRole.mockRejectedValue(new ForbiddenException('Requires editor'));
    const { service, supabase } = makeService(tables([row('m-1', 'L1', '10:00:00')]));

    await expect(
      service.saveRun(EVENT, { matchIds: ['m-1'], startAt: iso('10:30:00') }, 'user-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(queriedTables(supabase.from)).toEqual(['events']);
    expect(placement.placeMatches).not.toHaveBeenCalled();
  });

  it("refuses another Event's bout before reading the run's rows", async () => {
    const { service, supabase } = makeService(
      tables([
        row('m-1', 'L1', '10:00:00'),
        row('m-elsewhere', 'L9', '10:00:00', { phases: { tournaments: { event_id: 'event-2' } } }),
        row('m-2', 'L1', '10:05:00'),
      ]),
    );

    await expect(
      service.saveRun(
        EVENT,
        { matchIds: ['m-1', 'm-elsewhere', 'm-2'], startAt: iso('10:30:00') },
        'user-1',
      ),
    ).rejects.toThrow('Every Match must belong to this event');
    expect(selectsFor(supabase.from, 'matches')).toEqual([MEMBERSHIP_SELECT]);
    expect(placement.placeMatches).not.toHaveBeenCalled();
  });
});
