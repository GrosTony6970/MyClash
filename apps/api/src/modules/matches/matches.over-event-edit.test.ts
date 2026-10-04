import { ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { mockSupabase, writesTo } from '../../common/testing/supabase-chain';
import { FrozenResultsGuard } from './frozen-results.guard';
import { MatchesService } from './matches.service';

/**
 * Ruling 231: editing an Exchange asks no review. Once the winner follows a
 * correction, an unreviewed edit would move the result of an over Event, so
 * there it is a super admin's. The REAL guard is under test, over the same
 * seeded database as the service: a doubled guard would pin only the call.
 */
const ORGANISER = 'a0000000-0000-4000-8000-000000000001';
const SUPER_ADMIN = 'a0000000-0000-4000-8000-000000000002';
const EDIT = { type: 'no_exchange', noExchangeReason: 'other', reason: 'wrong side' };
const FROZEN = new ConflictException({
  message: 'Event results are frozen',
  code: 'event_results_frozen',
});

function setup(eventStatus: string) {
  const db = mockSupabase({
    exchanges: {
      rows: [{ id: 'ex-1', match_id: 'm1', voided: false, sequence: 3, round_number: 1 }],
      returning: { id: 'ex-2' },
    },
    matches: { rows: [{ id: 'm1', phase_id: 'phase-1', locked_at: null }] },
    phases: { rows: [{ id: 'phase-1', tournament_id: 'tournament-1' }] },
    tournaments: { rows: [{ id: 'tournament-1', event_id: 'event-1' }] },
    events: { rows: [{ id: 'event-1', status: eventStatus }] },
    platform_roles: { rows: [{ user_id: SUPER_ADMIN, role: 'super_admin' }] },
    // An edit closes the requests that wait on its hit (ruling 254): none here.
    exchange_edit_requests: { rows: [] },
  });
  const scoring = {
    recomputeMatchScore: vi.fn().mockResolvedValue({ redScore: 0, blueScore: 0 }),
    assertCorrectionLands: vi.fn().mockResolvedValue(undefined),
  };
  const service = new MatchesService(
    db as never,
    scoring as never,
    {} as never,
    {} as never,
    {} as never,
    new FrozenResultsGuard(db as never, {} as never),
  );
  return { db, scoring, service };
}

describe('MatchesService.editExchange — an over Event', () => {
  it.each<'completed' | 'archived'>(['completed', 'archived'])(
    'refuses an organiser on a %s Event, and writes nothing',
    async (status) => {
      const { db, scoring, service } = setup(status);

      await expect(
        service.editExchange('ex-1', EDIT as never, { userId: ORGANISER }),
      ).rejects.toEqual(FROZEN);
      expect(db.writes).toEqual([]);
      expect(scoring.recomputeMatchScore).not.toHaveBeenCalled();
    },
  );

  it('refuses a scorekeeper’s PIN session, which carries no account', async () => {
    const { db, service } = setup('archived');

    await expect(
      service.editExchange('ex-1', EDIT as never, { staffAccountId: 'staff-1' }),
    ).rejects.toEqual(FROZEN);
    expect(db.writes).toEqual([]);
  });

  it('lets a super admin edit on an archived Event', async () => {
    const { db, scoring, service } = setup('archived');

    await service.editExchange('ex-1', EDIT as never, { userId: SUPER_ADMIN });

    expect(writesTo(db, 'exchanges').map((write) => write.op)).toEqual(['update', 'insert']);
    expect(scoring.recomputeMatchScore).toHaveBeenCalledWith('m1');
  });

  it('lets an organiser edit while the Event runs', async () => {
    const { db, service } = setup('running');

    await service.editExchange('ex-1', EDIT as never, { userId: ORGANISER });

    expect(writesTo(db, 'exchanges').map((write) => write.op)).toEqual(['update', 'insert']);
  });
});
