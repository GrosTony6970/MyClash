/**
 * Locking the referee board tells every referee their duty (ADR-019). A duty that breaks
 * an Impossible rule — the one checker's verdict, through the board's `checkEvent` — refuses
 * the lock unless the organiser sends anyway (`{ confirm: true }`). An empty body is still
 * "no Impossible row, go": the e2e lock posts none.
 */
import { BadRequestException, ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { mockSupabase, scopedTo, writesTo } from '../../common/testing/supabase-chain';
import { AutoAssignController } from './auto-assign.controller';

const entry = (level: 'impossible' | 'discouraged', personName: string) => ({
  assignmentId: `ra-${personName}`,
  personId: personName,
  personName,
  unitId: 'pool-1',
  unitName: 'Longsword · Pool A',
  tournamentId: 't-1',
  role: 'arbitre_declarant',
  start: null,
  level,
  reasons: [],
});

function makeController(
  options: {
    conflicts?: ReturnType<typeof entry>[];
    updateError?: { message: string };
  } = {},
) {
  const supabase = mockSupabase({
    events: { rows: [{ id: 'event-1', organization_id: 'org-1' }] },
    referee_assignments: {
      data: options.updateError ? null : [{ id: 'ra-1' }, { id: 'ra-2' }],
      error: options.updateError ?? null,
    },
  });
  const notifications = { scheduleRefereeAssignmentStarting: vi.fn() };
  const follows = { scheduleRefereeStarting: vi.fn() };
  const events = { assignmentChanged: vi.fn() };
  const orgs = { assertOrgRole: vi.fn().mockResolvedValue(undefined) };
  const checkEvent = vi.fn().mockResolvedValue({ conflicts: options.conflicts ?? [], units: [] });
  const controller = new AutoAssignController(
    supabase as never,
    notifications as never,
    follows as never,
    events as never,
    orgs as never,
    { checkEvent } as never,
  );
  return { controller, supabase, checkEvent, notifications, orgs };
}

const REQ = { headers: {} } as never;

/** A refusal, or a loud failure when the call went through. */
const unexpected = (): never => {
  throw new Error('expected a refusal');
};

describe('locking the referee board (ADR-019)', () => {
  it('with no body and no Impossible duty, confirms every assigned row and notifies', async () => {
    const { controller, supabase, checkEvent, notifications, orgs } = makeController({
      conflicts: [entry('discouraged', 'Léa')],
    });

    await expect(controller.lockAssignments('event-1', undefined, REQ)).resolves.toEqual({
      confirmed: 2,
      notificationsScheduled: 2,
    });

    expect(orgs.assertOrgRole).toHaveBeenCalled();
    expect(checkEvent).toHaveBeenCalledWith('event-1');
    const [update] = writesTo(supabase, 'referee_assignments');
    expect(update?.row).toEqual({ status: 'confirmed' });
    expect(scopedTo(update, 'event_id')).toBe('event-1');
    expect(scopedTo(update, 'status')).toBe('assigned');
    expect(notifications.scheduleRefereeAssignmentStarting).toHaveBeenCalledTimes(2);
  });

  it('refuses 409 with the Impossible duties only, and locks nothing', async () => {
    const { controller, supabase } = makeController({
      conflicts: [entry('impossible', 'Marc'), entry('discouraged', 'Léa')],
    });

    const error = await controller
      .lockAssignments('event-1', {}, REQ)
      .then(unexpected, (e: unknown) => e as ConflictException);

    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getResponse()).toEqual({
      code: 'referee_lock_impossible',
      message: '1 referee assignment(s) break a rule that has no override',
      conflicts: [entry('impossible', 'Marc')],
    });
    expect(writesTo(supabase, 'referee_assignments')).toEqual([]);
  });

  it('sends anyway when the organiser confirms, without asking the checker', async () => {
    const { controller, supabase, checkEvent } = makeController({
      conflicts: [entry('impossible', 'Marc')],
    });

    await controller.lockAssignments('event-1', { confirm: true }, REQ);

    expect(checkEvent).not.toHaveBeenCalled();
    expect(writesTo(supabase, 'referee_assignments')).toHaveLength(1);
  });

  it('refuses a body it does not know, 400, before anything is read or written', async () => {
    const { controller, supabase, checkEvent } = makeController();
    await expect(
      controller.lockAssignments('event-1', { confirm: true, force: true }, REQ),
    ).rejects.toThrow(new BadRequestException('The lock takes { confirm?: boolean }'));
    expect(checkEvent).not.toHaveBeenCalled();
    expect(writesTo(supabase, 'referee_assignments')).toEqual([]);
  });

  it('a failed lock is a plain Error (a 5xx), never "nothing to lock"', async () => {
    const { controller } = makeController({ updateError: { message: 'connection reset' } });
    const failure = controller.lockAssignments('event-1', undefined, REQ);
    await expect(failure).rejects.toThrow(
      'Could not lock the referee assignments: connection reset',
    );
    await expect(failure).rejects.not.toHaveProperty('status');
  });

  it('a failed unlock is a plain Error (a 5xx)', async () => {
    const { controller } = makeController({ updateError: { message: 'connection reset' } });
    const failure = controller.unlockAssignments('event-1', REQ);
    await expect(failure).rejects.toThrow(
      'Could not unlock the referee assignments: connection reset',
    );
    await expect(failure).rejects.not.toHaveProperty('status');
  });
});
