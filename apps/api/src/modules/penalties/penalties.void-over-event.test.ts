import { ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { mockSupabase, scopedTo, writesTo } from '../../common/testing/supabase-chain';
import { FrozenResultsGuard } from '../matches/frozen-results.guard';
import { PenaltiesService } from './penalties.service';

/**
 * Ruling 231: voiding a card asks no review. Once the winner follows a
 * correction, an unreviewed void would move the result of an over Event, so
 * there it is a super admin's, as a new card already is. The REAL guard is
 * under test, over the same seeded database as the service.
 */
const ORGANISER = 'a0000000-0000-4000-8000-000000000001';
const SUPER_ADMIN = 'a0000000-0000-4000-8000-000000000002';
const FROZEN = new ConflictException({
  message: 'Event results are frozen',
  code: 'event_results_frozen',
});

function setup(eventStatus: string) {
  const db = mockSupabase({
    match_penalties: {
      rows: [{ id: 'card-1', match_id: 'm1', voided: false, client_uuid: 'card-uuid' }],
    },
    matches: { rows: [{ id: 'm1', phase_id: 'phase-1', locked_at: null, current_round: 1 }] },
    phases: { rows: [{ id: 'phase-1', tournament_id: 'tournament-1' }] },
    tournaments: {
      rows: [{ id: 'tournament-1', event_id: 'event-1', penalty_ruleset_id: 'ruleset-1' }],
    },
    events: { rows: [{ id: 'event-1', organization_id: 'org-1', status: eventStatus }] },
    platform_roles: { rows: [{ user_id: SUPER_ADMIN, role: 'super_admin' }] },
  });
  const askedWithWrites: number[] = [];
  const scoring = {
    recomputeMatchScore: vi.fn().mockResolvedValue({ redScore: 0, blueScore: 0 }),
    assertCorrectionLands: vi.fn(async () => void askedWithWrites.push(db.writes.length)),
  };
  const service = new PenaltiesService(
    db as never,
    scoring as never,
    new FrozenResultsGuard(db as never, {} as never),
  );
  return { db, scoring, service, askedWithWrites };
}

describe('PenaltiesService.voidPenalty — an over Event', () => {
  it.each<'completed' | 'archived'>(['completed', 'archived'])(
    'refuses an organiser on a %s Event, and writes nothing',
    async (status) => {
      const { db, scoring, service } = setup(status);

      await expect(
        service.voidPenalty('card-1', { reason: 'wrong fighter' }, { userId: ORGANISER }),
      ).rejects.toEqual(FROZEN);
      expect(db.writes).toEqual([]);
      expect(scoring.recomputeMatchScore).not.toHaveBeenCalled();
    },
  );

  it('refuses a scorekeeper’s PIN session, which carries no account', async () => {
    const { db, service } = setup('archived');

    await expect(
      service.voidPenalty('card-1', { reason: 'wrong fighter' }, { staffAccountId: 'staff-1' }),
    ).rejects.toEqual(FROZEN);
    expect(db.writes).toEqual([]);
  });

  it('lets a super admin void a card on an archived Event', async () => {
    const { db, scoring, service } = setup('archived');

    await service.voidPenalty('card-1', { reason: 'wrong fighter' }, { userId: SUPER_ADMIN });

    const [voided] = writesTo(db, 'match_penalties');
    expect(voided?.row).toMatchObject({ voided: true, voided_reason: 'wrong fighter' });
    expect(scopedTo(voided, 'id')).toBe('card-1');
    expect(scoring.recomputeMatchScore).toHaveBeenCalledWith('m1');
  });

  it('asks whether the correction lands BEFORE it writes (ruling 226)', async () => {
    const { scoring, service, askedWithWrites } = setup('running');

    await service.voidPenalty('card-1', { reason: 'wrong fighter' }, { userId: ORGANISER });

    expect(scoring.assertCorrectionLands).toHaveBeenCalledWith('m1', {
      dropPenaltyIds: ['card-1'],
    });
    expect(askedWithWrites).toEqual([0]);
  });

  it('a correction that is refused leaves the card as it was', async () => {
    const { db, scoring, service } = setup('running');
    const refusal = new ConflictException({ code: 'correction_later_bout_fought' });
    scoring.assertCorrectionLands.mockRejectedValueOnce(refusal);

    await expect(
      service.voidPenalty('card-1', { reason: 'wrong fighter' }, { userId: ORGANISER }),
    ).rejects.toBe(refusal);
    expect(db.writes).toEqual([]);
    expect(scoring.recomputeMatchScore).not.toHaveBeenCalled();
  });

  it('lets an organiser void a card while the Event runs', async () => {
    const { db, service } = setup('running');

    await service.voidPenalty('card-1', { reason: 'wrong fighter' }, { userId: ORGANISER });

    expect(writesTo(db, 'match_penalties')).toHaveLength(1);
  });
});

describe('PenaltiesService.createPenalty — a repeated card on an over Event', () => {
  const CARD = { registrationId: 'reg-red', occurredAt: '2026-10-03T10:00:00.000Z' };

  // The server saved it and the answer was lost: the pad's replay must get the
  // saved row, not the refusal it could not tell from "never taken".
  it.each<'completed' | 'archived'>(['completed', 'archived'])(
    'answers the saved card on a %s Event, and writes nothing',
    async (status) => {
      const { db, service } = setup(status);

      const saved = await service.createPenalty(
        'm1',
        { ...CARD, clientUuid: 'card-uuid', directCard: 'yellow', reason: 'late hit' } as never,
        { userId: ORGANISER },
      );

      expect(saved).toMatchObject({ id: 'card-1', client_uuid: 'card-uuid' });
      expect(db.writes).toEqual([]);
    },
  );

  it('still refuses a card the server does not hold', async () => {
    const { db, service } = setup('completed');

    await expect(
      service.createPenalty(
        'm1',
        { ...CARD, clientUuid: 'new-uuid', directCard: 'yellow', reason: 'late hit' } as never,
        { userId: ORGANISER },
      ),
    ).rejects.toEqual(FROZEN);
    expect(db.writes).toEqual([]);
  });
});
