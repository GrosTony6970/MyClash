/**
 * Removing a person from an Event's referee roster deletes their duties. While the
 * referee board is locked (ADR-019) that waits for an unlock — the referees were told —
 * unless the person holds no duty at all. A failed delete of the duties is a plain Error:
 * going on would drop the roster row and leave the person refereeing.
 */
import { ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { mockSupabase, scopedTo, writesTo } from '../../common/testing/supabase-chain';
import { QualificationsService } from './qualifications.service';

const duty = (over: Record<string, unknown> = {}) => ({
  id: 'ra-1',
  event_id: 'event-1',
  person_id: 'lea',
  status: 'confirmed',
  scope_type: 'pool',
  ...over,
});

function makeService(rows: Record<string, unknown>[]) {
  const supabase = mockSupabase({
    events: { rows: [{ id: 'event-1', organization_id: 'org-1' }] },
    referee_assignments: { rows },
    event_referees: { rows: [{ event_id: 'event-1', person_id: 'lea' }] },
  });
  const service = new QualificationsService(
    supabase as never,
    { assertOrgRole: vi.fn().mockResolvedValue(undefined) } as never,
  );
  return { service, supabase };
}

/** A refusal, or a loud failure when the call went through. */
const unexpected = (): never => {
  throw new Error('expected a refusal');
};

describe('removing a referee from the roster, and the lock (ADR-019)', () => {
  it('refuses 409 on a locked board when the person holds a duty, and deletes nothing', async () => {
    const { service, supabase } = makeService([duty()]);

    const error = await service
      .removeEventReferee('event-1', 'lea', 'user-1')
      .then(unexpected, (e: unknown) => e as ConflictException);

    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getResponse()).toMatchObject({ code: 'referee_board_locked' });
    expect(supabase.writes).toEqual([]);
  });

  it('removes a person with no duty from a locked board', async () => {
    // Somebody else's confirmed duty locks the board; Léa holds none.
    const { service, supabase } = makeService([duty({ person_id: 'marc' })]);

    await service.removeEventReferee('event-1', 'lea', 'user-1');

    expect(writesTo(supabase, 'event_referees')).toHaveLength(1);
  });

  it('on an unlocked board deletes the duties, then the roster row', async () => {
    const { service, supabase } = makeService([duty({ status: 'assigned' })]);

    await service.removeEventReferee('event-1', 'lea', 'user-1');

    const [cleared] = writesTo(supabase, 'referee_assignments');
    expect(cleared?.op).toBe('delete');
    expect(scopedTo(cleared, 'event_id')).toBe('event-1');
    expect(scopedTo(cleared, 'person_id')).toBe('lea');
    expect(writesTo(supabase, 'event_referees')).toHaveLength(1);
  });

  it('a failed delete of the duties is a plain Error, and the roster row stays', async () => {
    const ok = mockSupabase({
      events: { rows: [{ id: 'event-1', organization_id: 'org-1' }] },
      referee_assignments: { rows: [] },
      event_referees: { rows: [] },
    });
    const failing = mockSupabase({
      referee_assignments: { data: null, error: { message: 'connection reset' } },
    });
    let assignmentCalls = 0;
    const from = vi.fn((table: string) =>
      table === 'referee_assignments' && assignmentCalls++ > 0
        ? failing.from(table)
        : ok.from(table),
    );
    const service = new QualificationsService(
      { service: { from } } as never,
      { assertOrgRole: vi.fn().mockResolvedValue(undefined) } as never,
    );

    const failure = service.removeEventReferee('event-1', 'lea', 'user-1');
    await expect(failure).rejects.toThrow(
      "Could not remove the referee's duties: connection reset",
    );
    await expect(failure).rejects.not.toHaveProperty('status');
    expect(writesTo(ok, 'event_referees')).toEqual([]);
  });
});
