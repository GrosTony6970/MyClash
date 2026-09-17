import { beforeEach, describe, expect, it } from 'vitest';
import {
  EVENT,
  POOL,
  TOURNAMENT,
  iso,
  makeService,
  orgs,
  placed,
  placement,
  row,
  tables,
} from './schedule-run.fixtures';

/**
 * The rest break a Pool takes when its run is laid again (ADR-018).
 *
 * Its own file because `schedule-run.service.test.ts` reached the 400-line cap,
 * and because this is one rule rather than one method: a Pool's queue breaks once
 * in the middle of each piste, for the Tournament's rest or the Event's, and
 * nothing else breaks at all. Where those minutes turn into start times is
 * `lay-run.test.ts`; what the batch looks like is the file next door.
 */

beforeEach(() => {
  orgs.assertOrgRole.mockReset().mockResolvedValue(undefined);
  placement.placeMatches.mockReset().mockResolvedValue(undefined);
});

describe('ScheduleRunService.saveRun, the rest break', () => {
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

  it("takes a Tournament's own rest before the Event's", async () => {
    const inPool = { pool_id: POOL };
    const { service } = makeService(
      tables(
        [
          row('m-1', 'L1', '10:00:00', inPool),
          row('m-2', 'L1', '10:05:00', inPool),
          row('m-3', 'L1', '10:10:00', inPool),
          row('m-4', 'L1', '10:15:00', inPool),
        ],
        {
          matchGapSeconds: 30,
          minRestMinutes: 12,
          tournaments: [{ tournamentId: TOURNAMENT, minRestMinutes: 20 }],
        },
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
      // 11:15:00 plus the Tournament's twenty minutes, not the Event's twelve.
      iso('11:35:00'),
      iso('11:42:30'),
    ]);
  });

  it('lets a Tournament take no break where the Event takes one', async () => {
    // The commit's headline case, end to end: a row whose only field is a rest
    // of zero survives the sheet's schema, the embed names the Tournament, and
    // zero beats the Event's twelve rather than reading as a blank box.
    const inPool = { pool_id: POOL };
    const { service } = makeService(
      tables(
        [
          row('m-1', 'L1', '10:00:00', inPool),
          row('m-2', 'L1', '10:05:00', inPool),
          row('m-3', 'L1', '10:10:00', inPool),
          row('m-4', 'L1', '10:15:00', inPool),
        ],
        {
          matchGapSeconds: 30,
          minRestMinutes: 12,
          tournaments: [{ tournamentId: TOURNAMENT, minRestMinutes: 0 }],
        },
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

  it("takes no break when the sheet's rest is zero, even for a Pool", async () => {
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
});
