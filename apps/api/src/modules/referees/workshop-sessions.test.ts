import { describe, expect, it } from 'vitest';
import { filtersFor, mockSupabase, selectsFor } from '../../common/testing/supabase-chain';
import { loadWorkshopSessions } from './workshop-sessions';

const EVENT = 'event-1';

function seed(overrides: Partial<Record<string, unknown>> = {}) {
  return mockSupabase({
    workshops: {
      rows: [
        {
          id: 'w-cut',
          event_id: EVENT,
          title: 'Cutting 101',
          workshop_instructors: [{ global_person_id: 'gp-marc' }, { global_person_id: null }],
        },
        { id: 'w-other', event_id: 'event-2', title: 'Elsewhere', workshop_instructors: [] },
      ],
    },
    workshop_sessions: {
      rows: [
        {
          id: 's-cut',
          workshop_id: 'w-cut',
          starts_at: '2026-10-03T12:00:00Z',
          ends_at: '2026-10-03T13:00:00Z',
          status: 'scheduled',
        },
        { id: 's-off', workshop_id: 'w-cut', starts_at: null, ends_at: null, status: 'cancelled' },
      ],
    },
    workshop_enrollments: {
      rows: [
        { workshop_session_id: 's-cut', user_id: 'p-lea', status: 'confirmed' },
        { workshop_session_id: 's-cut', user_id: 'p-paul', status: 'intent' },
        { workshop_session_id: 's-cut', user_id: 'p-wait', status: 'waitlisted' },
        { workshop_session_id: 's-cut', user_id: 'p-gone', status: 'cancelled' },
        { workshop_session_id: 's-cut', user_id: 'p-no', status: 'refused' },
        { workshop_session_id: 's-cut', user_id: 'p-guest', status: 'confirmed' },
      ],
    },
    persons: {
      rows: [
        { id: 'p-lea', global_person_id: 'gp-lea' },
        { id: 'p-paul', global_person_id: 'gp-paul' },
        { id: 'p-wait', global_person_id: 'gp-wait' },
        { id: 'p-gone', global_person_id: 'gp-gone' },
        { id: 'p-no', global_person_id: 'gp-no' },
        { id: 'p-guest', global_person_id: null },
      ],
    },
    ...overrides,
  } as Parameters<typeof mockSupabase>[0]);
}

describe('loadWorkshopSessions', () => {
  it('lists each running session of the Event with its instructors and attendees', async () => {
    const db = seed();
    expect(await loadWorkshopSessions(db.service as never, EVENT)).toEqual([
      {
        sessionId: 's-cut',
        title: 'Cutting 101',
        startsAt: '2026-10-03T12:00:00Z',
        endsAt: '2026-10-03T13:00:00Z',
        instructorIds: ['gp-marc'],
        // confirmed + intent (ruling 134), resolved from the event-scoped person;
        // a guest with no global person drops out.
        attendeeIds: ['gp-lea', 'gp-paul'],
      },
    ]);
  });

  it('asks for exactly the columns it maps, and the filters that decide who counts', async () => {
    const db = seed();
    await loadWorkshopSessions(db.service as never, EVENT);
    expect(selectsFor(db.from, 'workshops')).toEqual([
      'id, title, workshop_instructors(global_person_id)',
    ]);
    expect(selectsFor(db.from, 'workshop_sessions')).toEqual([
      'id, workshop_id, starts_at, ends_at',
    ]);
    expect(selectsFor(db.from, 'workshop_enrollments')).toEqual(['workshop_session_id, user_id']);
    expect(selectsFor(db.from, 'persons')).toEqual(['id, global_person_id']);
    expect(filtersFor(db.from, 'workshop_sessions', 'neq')).toEqual([['status', 'cancelled']]);
    expect(filtersFor(db.from, 'workshop_enrollments', 'in')).toContainEqual([
      'status',
      ['confirmed', 'intent'],
    ]);
  });

  it('keeps a session with no time yet, with null ends', async () => {
    const db = seed({
      workshop_sessions: {
        rows: [
          {
            id: 's-tbd',
            workshop_id: 'w-cut',
            starts_at: null,
            ends_at: null,
            status: 'scheduled',
          },
        ],
      },
      workshop_enrollments: { rows: [] },
    });
    const [session] = await loadWorkshopSessions(db.service as never, EVENT);
    expect(session).toMatchObject({
      sessionId: 's-tbd',
      startsAt: null,
      endsAt: null,
      attendeeIds: [],
    });
  });

  it('reads nothing further when the Event has no Workshop', async () => {
    const db = seed({ workshops: { rows: [] } });
    expect(await loadWorkshopSessions(db.service as never, EVENT)).toEqual([]);
    expect(selectsFor(db.from, 'workshop_sessions')).toEqual([]);
  });

  it.each(['workshops', 'workshop_sessions', 'workshop_enrollments', 'persons'])(
    'a failed read of %s is a plain Error, never an empty answer',
    async (table) => {
      const db = seed({ [table]: { data: null, error: { message: 'boom' } } });
      const failure = loadWorkshopSessions(db.service as never, EVENT);
      await expect(failure).rejects.toThrow(/Could not read .*: boom/);
      await expect(failure).rejects.not.toHaveProperty('status');
    },
  );
});
