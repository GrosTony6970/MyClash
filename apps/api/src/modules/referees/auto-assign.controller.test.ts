/**
 * Locking the referee board tells every referee their duty (ADR-019). A duty that breaks
 * an Impossible rule — the one checker's verdict, through the board's `checkEvent` — refuses
 * the lock unless the organiser sends anyway over exactly the duties it listed (ruling 138:
 * a duty that turned red after the list was shown is never sent unseen). An empty body is
 * still "no Impossible row, go": the e2e lock posts none.
 */
import { BadRequestException, ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { mockSupabase, scopedTo, writesTo } from '../../common/testing/supabase-chain';
import { AutoAssignController } from './auto-assign.controller';

const clash = (code: string, matchId: string) => ({
  code,
  level: code === 'own_pool' ? 'discouraged' : 'impossible',
  against: { kind: 'match', id: matchId, label: 'Longsword · Pool B' },
  confirmed: false,
});

const entry = (
  level: 'impossible' | 'discouraged',
  personName: string,
  reasons = [clash(level === 'impossible' ? 'fights_overlap' : 'own_pool', 'm-9')],
) => ({
  assignmentId: `ra-${personName}`,
  personId: personName,
  personName,
  unitId: 'pool-1',
  unitName: 'Longsword · Pool A',
  tournamentId: 't-1',
  role: 'arbitre_declarant',
  start: null,
  level,
  reasons,
});

/** The key the refusal gives Marc's duty, as the page sends it back. */
const MARC_KEY = 'pool-1|Marc|arbitre_declarant|fights_overlap:m-9';

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
      conflicts: [{ ...entry('impossible', 'Marc'), key: MARC_KEY }],
    });
    expect(writesTo(supabase, 'referee_assignments')).toEqual([]);
  });

  it('sends anyway over exactly the duties it listed', async () => {
    const { controller, supabase } = makeController({
      conflicts: [entry('impossible', 'Marc'), entry('discouraged', 'Léa')],
    });

    await controller.lockAssignments('event-1', { confirmedDuties: [MARC_KEY] }, REQ);

    expect(writesTo(supabase, 'referee_assignments')).toHaveLength(1);
  });

  /** The keys a first refusal listed, as the page sends them back. */
  async function keysShown(conflicts: ReturnType<typeof entry>[]): Promise<string[]> {
    const refusal = await makeController({ conflicts })
      .controller.lockAssignments('event-1', {}, REQ)
      .then(unexpected, (e: unknown) => e as ConflictException);
    return (refusal.getResponse() as { conflicts: Array<{ key: string }> }).conflicts.map(
      (c) => c.key,
    );
  }

  it.each([
    [
      'a duty that turned red after the list was shown',
      [entry('impossible', 'Marc'), entry('impossible', 'Anne')],
    ],
    [
      'a new red reason on a duty already listed',
      [
        entry('impossible', 'Marc', [
          clash('fights_overlap', 'm-9'),
          clash('teaches_overlap', 'ws-1'),
        ]),
      ],
    ],
  ])('refuses again, with the whole list, over %s', async (_l, later) => {
    const shown = await keysShown([entry('impossible', 'Marc')]);
    const { controller, supabase } = makeController({ conflicts: later });

    const error = await controller
      .lockAssignments('event-1', { confirmedDuties: shown }, REQ)
      .then(unexpected, (e: unknown) => e as ConflictException);

    expect(error.getResponse()).toMatchObject({
      code: 'referee_lock_impossible',
      conflicts: later.map((c) => expect.objectContaining({ personId: c.personId })),
    });
    expect(writesTo(supabase, 'referee_assignments')).toEqual([]);
  });

  it('refuses a body it does not know, 400, before anything is read or written', async () => {
    const { controller, supabase, checkEvent } = makeController();
    await expect(controller.lockAssignments('event-1', { confirm: true }, REQ)).rejects.toThrow(
      new BadRequestException('The lock takes { confirmedDuties?: string[] }'),
    );
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
