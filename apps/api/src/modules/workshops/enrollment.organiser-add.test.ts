/**
 * The organiser books only a person of this Event (operator ruling 535).
 *
 * "Longsword basics" belongs to the Event of club A. The organiser's door names the person by id,
 * and a booking's person has no foreign key: before this, a person of club B's Event could be
 * booked here, and the roster then showed a stranger's name to club A. The door now asks the
 * person to be on the session's Event, before any write.
 */
import { HttpException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { mockSupabase, selectsFor, writesTo } from '../../common/testing/supabase-chain';
import { EnrollmentService } from './enrollment.service';

const SESSION = 's-1';
const EVENT = 'ev-a';
const row = (data: unknown) => ({ data, error: null });

const PEOPLE = [
  { id: 'lea', event_id: EVENT, global_person_id: null },
  { id: 'tom', event_id: 'ev-b', global_person_id: null },
];

function build(
  persons: Parameters<typeof mockSupabase>[0][string] = { rows: PEOPLE },
  workshop: Record<string, unknown> = { capacity: null, status: 'draft', event_id: EVENT },
) {
  const supabase = mockSupabase({
    // The session booked, then the Workshop's sessions: this one alone (rulings 520-523).
    workshop_sessions: [
      row({ status: 'scheduled', workshop_id: 'w-1', workshops: workshop }),
      row([{ id: SESSION }]),
    ],
    persons,
    // No booking yet, then the insert's read-back.
    workshop_enrollments: [row(null), row({ id: 'e-1' })],
  });
  const alert = vi.fn().mockResolvedValue(undefined);
  const service = new EnrollmentService(
    supabase as never,
    {} as never,
    { scheduleWorkshopSessionStarting: alert } as never,
  );
  return { service, supabase, alert };
}

describe('the organiser books only a person of this Event', () => {
  it.each([
    ['of another Event', 'tom'],
    ['nobody has', 'ghost'],
  ])('refuses a person %s, writing nothing', async (_case, personId) => {
    const { service, supabase, alert } = build();

    const refusal = await service.enroll(SESSION, personId).catch((e: unknown) => e);

    expect(refusal).toBeInstanceOf(HttpException);
    expect((refusal as HttpException).getStatus()).toBe(404);
    // The exception filter sends `error` as the code PERSON_NOT_IN_EVENT.
    expect((refusal as HttpException).getResponse()).toEqual({
      error: 'PersonNotInEvent',
      message: 'This person is not on this event.',
    });
    expect(writesTo(supabase, 'workshop_enrollments')).toEqual([]);
    expect(alert).not.toHaveBeenCalled();
  });

  it('books a person of this Event, having read the Event off the session', async () => {
    const { service, supabase } = build();

    await expect(service.enroll(SESSION, 'lea')).resolves.toMatchObject({
      id: 'e-1',
      status: 'confirmed',
    });
    expect(writesTo(supabase, 'workshop_enrollments')).toHaveLength(1);
    // The double ignores the projection: only this holds the column the check reads.
    expect(selectsFor(supabase.from, 'workshop_sessions')[0]).toBe(
      'status, workshop_id, workshops ( capacity, status, event_id )',
    );
    expect(selectsFor(supabase.from, 'persons')[0]).toBe('id');
  });

  it('throws when the session names no Event, rather than book anyone', async () => {
    const { service, supabase } = build(undefined, { capacity: null, status: 'draft' });

    const failure = await service.enroll(SESSION, 'lea').catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(HttpException);
    expect(writesTo(supabase, 'workshop_enrollments')).toEqual([]);
  });

  it('throws on a persons read that failed, never "not on this Event", and writes nothing', async () => {
    const { service, supabase } = build({ data: null, error: { message: 'boom' } });

    const failure = await service.enroll(SESSION, 'lea').catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(HttpException);
    expect(writesTo(supabase, 'workshop_enrollments')).toEqual([]);
  });
});
