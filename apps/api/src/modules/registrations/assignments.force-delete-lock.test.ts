/**
 * Force-deleting a person from an Event while the referee board is locked (ADR-019): a
 * deletion that takes a referee duty with it waits for an unlock — the person's own
 * duties, or the crew of a bout of theirs that goes with them (0179 cascades those rows).
 * Refused before the first delete.
 *
 * The assignment report is `assignments.service.test.ts`'s; it is stubbed here to say what
 * the person holds. The lock and crew reads run on a seeded `referee_assignments`.
 */
import { ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { mockSupabase, writesTo } from '../../common/testing/supabase-chain';
import { AssignmentsService } from './assignments.service';

const REG_EVENT = { id: 't-1', name: 'LS', event_id: 'event-1' };
const LOCK = { id: 'ra-lock', event_id: 'event-1', status: 'confirmed', scope_type: 'pool' };

function makeService(options: {
  crews: Record<string, unknown>[];
  ownDuties: number;
  locked: boolean;
}) {
  const supabase = mockSupabase({
    referee_assignments: { rows: [...(options.locked ? [LOCK] : []), ...options.crews] },
    registrations: {
      rows: [{ id: 'reg-1', person_id: 'person-1', tournament_id: 't-1', tournaments: REG_EVENT }],
    },
    matches: { data: null, error: null },
    persons: { data: null, error: null },
  });
  const service = new AssignmentsService(supabase as never);
  vi.spyOn(service, 'getEventAssignments').mockResolvedValue({
    hasBlockingMatch: false,
    blockingMatches: [],
    matchesAsFighter: [{ matchId: 'm-1' }],
    refereeAssignments: Array.from({ length: options.ownDuties }, (_, i) => ({
      assignmentId: `own-${i}`,
    })),
  } as never);
  return { service, supabase };
}

const crewOn = (matchId: string) => ({
  id: `crew-${matchId}`,
  event_id: 'event-1',
  status: 'assigned',
  scope_type: 'match',
  match_id: matchId,
});

/** A refusal, or a loud failure when the call went through. */
const unexpected = (): never => {
  throw new Error('expected a refusal');
};

describe('force-deleting a person, and the referee lock (ADR-019)', () => {
  it.each([
    ['holds a duty of their own', { crews: [], ownDuties: 1 }],
    ['fights a bout that has a crew', { crews: [crewOn('m-1')], ownDuties: 0 }],
  ])('refuses 409 on a locked board when the person %s, deleting nothing', async (_l, o) => {
    const { service, supabase } = makeService({ ...o, locked: true });

    const error = await service
      .forceDeletePersonInEvent('person-1', 'event-1')
      .then(unexpected, (e: unknown) => e as ConflictException);

    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getResponse()).toMatchObject({ code: 'referee_board_locked' });
    expect(supabase.writes).toEqual([]);
  });

  it("goes ahead on a locked board when no duty goes (a crew on someone else's bout)", async () => {
    const { service, supabase } = makeService({
      crews: [crewOn('m-2')],
      ownDuties: 0,
      locked: true,
    });

    await service.forceDeletePersonInEvent('person-1', 'event-1');

    expect(writesTo(supabase, 'persons').map((w) => w.op)).toEqual(['delete']);
  });

  it('goes ahead on an unlocked board, duties and all', async () => {
    const { service, supabase } = makeService({
      crews: [crewOn('m-1')],
      ownDuties: 1,
      locked: false,
    });

    await service.forceDeletePersonInEvent('person-1', 'event-1');

    expect(writesTo(supabase, 'referee_assignments').map((w) => w.op)).toEqual(['delete']);
    expect(writesTo(supabase, 'persons').map((w) => w.op)).toEqual(['delete']);
  });
});

describe('force-deleting one registration, and the referee lock (ADR-019)', () => {
  it('refuses 409 on a locked board when a bout it deletes has a crew, deleting nothing', async () => {
    const { service, supabase } = makeService({
      crews: [crewOn('m-1')],
      ownDuties: 0,
      locked: true,
    });

    const error = await service
      .forceDeleteRegistration('reg-1')
      .then(unexpected, (e: unknown) => e as ConflictException);

    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getResponse()).toMatchObject({ code: 'referee_board_locked' });
    expect(supabase.writes).toEqual([]);
  });

  it('goes ahead on a locked board when its bouts have no crew', async () => {
    const { service, supabase } = makeService({
      crews: [crewOn('m-2')],
      ownDuties: 0,
      locked: true,
    });

    await service.forceDeleteRegistration('reg-1');

    expect(writesTo(supabase, 'matches').map((w) => w.op)).toEqual(['delete']);
    expect(writesTo(supabase, 'registrations').map((w) => w.op)).toEqual(['delete']);
  });
});
