import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { StaffService } from '../staff/staff.service';
import { PenaltiesController } from './penalties.controller';
import { SUPER_ADMIN, setup, written } from './penalties.void-black-card.fixtures';

/**
 * Ruling 337: on an over Event a black card whose forfeit stands is not taken
 * back. Its void restores the bout the forfeit found, running or paused, the
 * Pool bouts forfeited with it and the Fighter's status, and on an over Event
 * nobody can end a bout again: the clock and the pad are refused for everybody.
 * A hit's correction already never hands a bout back there (rulings 225 to 230).
 *
 * Only a super admin reaches the handler on an over Event (rulings 231, 251),
 * so the first block enters at the REAL controller with the REAL "who may
 * score", over the same seeded database as the two real services.
 */
type Over = 'completed' | 'archived';
const OVER: Over[] = ['completed', 'archived'];
const EVENT_OVER = new ConflictException({
  message: 'The Event is over: nobody could end the bouts this black card closed',
  code: 'black_card_undo_refused',
});

function door(seed: Parameters<typeof setup>[0]) {
  const { db, scoring, service } = setup(seed);
  // No role in the club: a role would hide that the super admin passes without one.
  const orgs = {
    assertOrgRole: vi.fn().mockRejectedValue(new ForbiddenException('Not a member')),
  };
  const staff = new StaffService(db as never, orgs as never, {} as never, {} as never);
  vi.spyOn(
    staff as never as { getSupabaseUserId: () => Promise<string | null> },
    'getSupabaseUserId',
  ).mockResolvedValue(SUPER_ADMIN);
  const controller = new PenaltiesController(service, db as never, staff, orgs as never);
  const req = {
    cookies: {},
    headers: { authorization: 'Bearer token' },
  } as never as FastifyRequest;
  const send = () =>
    controller.voidPenalty('card-black', { reason: 'wrong fighter' } as never, req);
  return { db, scoring, send };
}

describe('PATCH match-penalties/:id/void: a black card on an over Event (ruling 337)', () => {
  it.each(OVER)(
    'a super admin is refused on a %s Event, and nothing is written',
    async (status) => {
      const { db, scoring, send } = door({ eventStatus: status });

      await expect(send()).rejects.toEqual(EVENT_OVER);

      // Whole or not at all: the bout, the Fighter, the forfeit and the card stay.
      expect(db.writes).toEqual([]);
      expect(scoring.recomputeMatchScore).not.toHaveBeenCalled();
    },
  );

  it.each(OVER)(
    'a black card that made no forfeit is still taken back on a %s Event',
    async (status) => {
      const { db, scoring, send } = door({ eventStatus: status, forfeit: null });

      await send();

      expect(written(db)).toEqual(['match_penalties', 'tournament_penalty_reviews']);
      expect(scoring.recomputeMatchScore).toHaveBeenCalledWith('m1');
    },
  );

  it.each(OVER)(
    'a forfeit somebody voided already keeps nothing back on a %s Event',
    async (status) => {
      const { db, send } = door({
        eventStatus: status,
        forfeit: { voided_at: '2026-10-06T10:05:00.000Z' },
      });

      await send();

      expect(written(db)).toEqual(['match_penalties', 'tournament_penalty_reviews']);
    },
  );
});

describe('PenaltiesService.voidPenalty: the Event of a black card', () => {
  it('while the Event runs the forfeit is taken back, as before', async () => {
    const { db, undo } = setup({ eventStatus: 'running' });

    await undo();

    expect(written(db)).toContain('match_forfeits');
  });

  // Asked of the Event, not of the caller: the rule is "nobody is there to end it".
  it('an over Event refuses a super admin at the service too', async () => {
    const { db, undo } = setup({ eventStatus: 'archived' });

    await expect(undo('card-black', { userId: SUPER_ADMIN })).rejects.toEqual(EVENT_OVER);
    expect(db.writes).toEqual([]);
  });
});
