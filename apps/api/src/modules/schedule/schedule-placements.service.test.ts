import { beforeEach, describe, expect, it } from 'vitest';
import { ConflictException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ANONYMOUS_USER_ID } from '../../common/auth/request-user';
import {
  filtersFor,
  mockSupabase,
  queriedTables,
  selectsFor,
} from '../../common/testing/supabase-chain';
import {
  EVENT,
  MEMBERSHIP_SELECT,
  iso,
  orgs,
  placement,
  row,
  tables,
} from './schedule-run.fixtures';
import { SchedulePlacementsService } from './schedule-placements.service';

/**
 * The schedule board's batch save, on the seeded double the run save uses. The
 * placement owner is doubled: whether the pistes accept the batch is
 * `match-placement.service.test.ts`'s and `tests/drag/multi-bout.spec.ts`'s; what
 * is asserted here is who may send it, which Event its bouts must be in, and
 * that the batch reaches the owner ONCE and as sent.
 */

function makeService(rows: Array<ReturnType<typeof row>>) {
  const supabase = mockSupabase(tables(rows));
  const service = new SchedulePlacementsService(
    supabase as never,
    orgs as never,
    placement as never,
  );
  return { service, supabase };
}

const PLACE = { matchId: 'm-1', liceId: 'L1', scheduledAt: iso('10:43:00') };
const CLEAR = { matchId: 'm-2', liceId: null, scheduledAt: null };

beforeEach(() => {
  orgs.assertOrgRole.mockReset().mockResolvedValue(undefined);
  placement.placeMatches.mockReset().mockResolvedValue(undefined);
});

describe('SchedulePlacementsService.savePlacements', () => {
  it('checks the editor bar, then the Event, then hands the batch on once, clears as null', async () => {
    const { service, supabase } = makeService([
      row('m-1', 'L1', '10:00:00'),
      row('m-2', 'L1', '10:05:00'),
    ]);

    const result = await service.savePlacements(EVENT, { placements: [PLACE, CLEAR] }, 'user-1');

    expect(orgs.assertOrgRole).toHaveBeenCalledWith('org-1', 'user-1', 'editor');
    expect(queriedTables(supabase.from)).toEqual(['events', 'matches']);
    expect(selectsFor(supabase.from, 'matches')).toEqual([MEMBERSHIP_SELECT]);
    expect(filtersFor(supabase.from, 'matches', 'in')).toEqual([['id', ['m-1', 'm-2']]]);
    expect(placement.placeMatches).toHaveBeenCalledExactlyOnceWith(EVENT, [PLACE, CLEAR]);
    // After the membership read, never before it.
    expect(placement.placeMatches.mock.invocationCallOrder[0]).toBeGreaterThan(
      supabase.from.mock.invocationCallOrder.at(-1)!,
    );
    expect(result).toEqual({ placed: 2 });
  });

  it('asks a signed-out caller to sign in, as the single PATCH did, and reads nothing', async () => {
    // A lapsed session. The org check would answer "not a member" in English;
    // a 401 is what the board words as "Your session has expired".
    const { service, supabase } = makeService([row('m-1', 'L1', '10:00:00')]);

    await expect(
      service.savePlacements(EVENT, { placements: [PLACE] }, ANONYMOUS_USER_ID),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(queriedTables(supabase.from)).toEqual([]);
    expect(orgs.assertOrgRole).not.toHaveBeenCalled();
    expect(placement.placeMatches).not.toHaveBeenCalled();
  });

  it('reads no Match and places nothing for a caller below the editor bar', async () => {
    orgs.assertOrgRole.mockRejectedValue(new ForbiddenException('Requires editor'));
    const { service, supabase } = makeService([row('m-1', 'L1', '10:00:00')]);

    await expect(
      service.savePlacements(EVENT, { placements: [PLACE] }, 'user-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(queriedTables(supabase.from)).toEqual(['events']);
    expect(placement.placeMatches).not.toHaveBeenCalled();
  });

  it("refuses another Event's bout among the Event's own, and places none", async () => {
    const { service } = makeService([
      row('m-1', 'L1', '10:00:00'),
      row('m-elsewhere', 'L9', '10:00:00', { phases: { tournaments: { event_id: 'event-2' } } }),
      row('m-2', 'L1', '10:05:00'),
    ]);

    await expect(
      service.savePlacements(
        EVENT,
        { placements: [PLACE, { ...CLEAR, matchId: 'm-elsewhere' }, CLEAR] },
        'user-1',
      ),
    ).rejects.toThrow('Every Match must belong to this event');
    expect(placement.placeMatches).not.toHaveBeenCalled();
  });

  it("passes the placement owner's refusal on to the board", async () => {
    placement.placeMatches.mockRejectedValue(new ConflictException('Piste already busy'));
    const { service } = makeService([row('m-1', 'L1', '10:00:00')]);

    await expect(
      service.savePlacements(EVENT, { placements: [PLACE] }, 'user-1'),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
