import { HttpException } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { filtersFor, mockSupabase, selectsFor } from '../../common/testing/supabase-chain';
import { readPersonTeaching, readPersonWorkshops } from './person-workshops';

const TOM = 'p-tom';

type Line = { global_person_id: string | null; display_name: string | null };
const JEAN: Line = { global_person_id: 'gp-jean', display_name: 'Jean Dupont' };

/** One booking of a session, as the read embeds it. */
const booking = (
  person: string,
  session: string,
  status: string,
  sessionStatus = 'scheduled',
  instructors: Line[] = [JEAN],
) => ({
  user_id: person,
  status,
  workshop_sessions: {
    id: session,
    starts_at: '2027-05-22T12:00:00+00:00',
    ends_at: '2027-05-22T13:00:00+00:00',
    location_label: 'Hall B',
    status: sessionStatus,
    workshops: {
      title: `Workshop ${session}`,
      slug: `workshop-${session}`,
      workshop_instructors: instructors,
    },
  },
});

function seeded() {
  return mockSupabase({
    workshop_enrollments: {
      rows: [
        booking(TOM, 's-seat', 'confirmed'),
        booking(TOM, 's-intent', 'intent'),
        booking(TOM, 's-wait', 'waitlisted'),
        booking(TOM, 's-refused', 'refused'),
        booking(TOM, 's-cancelled', 'cancelled'),
        // Another person's seat: the read must not hand it to Tom.
        booking('p-lea', 's-lea', 'confirmed'),
      ],
    },
  });
}

const read = (
  db: ReturnType<typeof mockSupabase>,
  own: boolean,
  hidden: (ids: string[]) => Promise<Set<string>> = async () => new Set(),
) => readPersonWorkshops({ from: db.from } as unknown as SupabaseClient, TOM, own, hidden);

describe('readPersonWorkshops', () => {
  it('hands the person their seats, their waitlist places marked, and their refusals apart', async () => {
    const result = await read(seeded(), true);

    expect(result.workshops.map((w) => [w.workshopId, w.status])).toEqual([
      ['s-seat', 'confirmed'],
      ['s-intent', 'confirmed'],
      ['s-wait', 'waitlisted'],
    ]);
    // A refusal is no Workshop of the schedule: it is named apart, by its session.
    expect(result.refusedWorkshopIds).toEqual(['s-refused']);
  });

  it('hands anybody else the seats only: no waitlist place, no refusal', async () => {
    const result = await read(seeded(), false);

    expect(result.workshops.map((w) => [w.workshopId, w.status])).toEqual([
      ['s-seat', 'confirmed'],
      ['s-intent', 'confirmed'],
    ]);
    expect(result.refusedWorkshopIds).toEqual([]);
  });

  it('keeps what a schedule card shows of a Workshop', async () => {
    const [seat] = (await read(seeded(), false)).workshops;

    expect(seat).toEqual({
      workshopId: 's-seat',
      workshopSlug: 'workshop-s-seat',
      workshopName: 'Workshop s-seat',
      sessionStart: '2027-05-22T12:00:00+00:00',
      sessionEnd: '2027-05-22T13:00:00+00:00',
      location: 'Hall B',
      status: 'confirmed',
      sessionCancelled: false,
      instructorNames: ['Jean Dupont'],
    });
  });

  it('names every instructor, less one who hides their Workshops publicly (ruling 132)', async () => {
    const ana: Line = { global_person_id: 'gp-ana', display_name: 'Ana Ruiz' };
    const hider: Line = { global_person_id: 'gp-hider', display_name: 'Hidden Person' };
    const db = mockSupabase({
      workshop_enrollments: {
        rows: [
          booking(TOM, 's-duo', 'confirmed', 'scheduled', [JEAN, hider, ana]),
          booking(TOM, 's-none', 'confirmed', 'scheduled', []),
        ],
      },
    });
    const asked: string[][] = [];
    const { workshops } = await read(db, false, async (ids) => {
      asked.push(ids);
      return new Set(['gp-hider']);
    });

    expect(asked).toEqual([['gp-jean', 'gp-hider', 'gp-ana']]);
    expect(workshops.map((w) => [w.workshopId, w.instructorNames])).toEqual([
      ['s-duo', ['Jean Dupont', 'Ana Ruiz']],
      ['s-none', []],
    ]);
  });

  it('says which seat is in a cancelled session: the schedule strikes it through (526, 529)', async () => {
    const db = mockSupabase({
      workshop_enrollments: {
        rows: [booking(TOM, 's-sat', 'confirmed', 'cancelled'), booking(TOM, 's-sun', 'confirmed')],
      },
    });
    const { workshops } = await read(db, true);
    expect(workshops.map((w) => [w.workshopId, w.sessionCancelled])).toEqual([
      ['s-sat', true],
      ['s-sun', false],
    ]);
  });

  it('asks the database for the status, for this person, and only for the states the reader may know', async () => {
    const own = seeded();
    await read(own, true);
    const [select] = selectsFor(own.from, 'workshop_enrollments');
    expect(select?.replace(/\s+/g, ' ').trim()).toBe(
      'status, workshop_sessions ( id, starts_at, ends_at, location_label, status, workshops ( title, slug, workshop_instructors ( global_person_id, display_name ) ) )',
    );
    expect(filtersFor(own.from, 'workshop_enrollments', 'eq')).toEqual([['user_id', TOM]]);
    expect(filtersFor(own.from, 'workshop_enrollments', 'in')).toEqual([
      ['status', ['confirmed', 'intent', 'waitlisted', 'refused']],
    ]);

    const other = seeded();
    await read(other, false);
    expect(filtersFor(other.from, 'workshop_enrollments', 'in')).toEqual([
      ['status', ['confirmed', 'intent']],
    ]);
  });

  it('answers a failed read with a plain Error, never with "no booking"', async () => {
    const db = mockSupabase({
      workshop_enrollments: { data: null, error: { message: 'connection lost' } },
    });

    const failure = await read(db, true).catch((err: unknown) => err);

    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(HttpException);
    expect((failure as Error).message).toBe(
      `Could not read the Workshops of person ${TOM}: connection lost`,
    );
  });
});

const EVENT = 'ev-1';
const ME = 'gp-me';

/** One instructor line of a Workshop, as the read embeds it. */
const line = (
  person: string,
  eventId: string,
  slug: string,
  sessions: Array<{ id: string; status?: string }>,
  workshopStatus = 'published',
) => ({
  global_person_id: person,
  workshops: {
    slug,
    title: `Workshop ${slug}`,
    event_id: eventId,
    status: workshopStatus,
    workshop_sessions: sessions.map((s) => ({
      id: s.id,
      starts_at: '2027-05-22T16:00:00+00:00',
      ends_at: '2027-05-22T18:00:00+00:00',
      location_label: 'Hall C',
      status: s.status ?? 'scheduled',
    })),
  },
});

const teach = (db: ReturnType<typeof mockSupabase>, own = false) =>
  readPersonTeaching({ from: db.from } as unknown as SupabaseClient, EVENT, ME, own);

describe('readPersonTeaching', () => {
  it("hands back each session of this Event's Workshops the person teaches, one row each", async () => {
    const db = mockSupabase({
      workshop_instructors: {
        rows: [
          line(ME, EVENT, 'cutting', [{ id: 's-sat' }, { id: 's-sun', status: 'cancelled' }]),
          // Another Event's Workshop: not this schedule.
          line(ME, 'ev-other', 'elsewhere', [{ id: 's-other' }]),
          // No session yet: nothing to be at.
          line(ME, EVENT, 'drawer', []),
          // Somebody else's class.
          line('gp-jean', EVENT, 'jean', [{ id: 's-jean' }]),
        ],
      },
    });

    expect(await teach(db)).toEqual([
      {
        sessionId: 's-sat',
        workshopSlug: 'cutting',
        workshopName: 'Workshop cutting',
        sessionStart: '2027-05-22T16:00:00+00:00',
        sessionEnd: '2027-05-22T18:00:00+00:00',
        location: 'Hall C',
        sessionCancelled: false,
      },
      expect.objectContaining({ sessionId: 's-sun', sessionCancelled: true }),
    ]);
    const [select] = selectsFor(db.from, 'workshop_instructors');
    expect(select?.replace(/\s+/g, ' ').trim()).toBe(
      'workshops ( slug, title, event_id, status, workshop_sessions ( id, starts_at, ends_at, location_label, status ) )',
    );
    expect(filtersFor(db.from, 'workshop_instructors', 'eq')).toEqual([['global_person_id', ME]]);
  });

  it("shows a draft Workshop's sessions to its instructor alone: a draft is the organiser's", async () => {
    const seed = () =>
      mockSupabase({
        workshop_instructors: {
          rows: [
            line(ME, EVENT, 'secret', [{ id: 's-draft' }], 'draft'),
            line(ME, EVENT, 'open', [{ id: 's-open' }], 'running'),
          ],
        },
      });

    expect((await teach(seed(), false)).map((s) => s.sessionId)).toEqual(['s-open']);
    expect((await teach(seed(), true)).map((s) => s.sessionId)).toEqual(['s-draft', 's-open']);
  });

  it('answers a failed read with a plain Error, never with "teaches nothing"', async () => {
    const db = mockSupabase({
      workshop_instructors: { data: null, error: { message: 'connection lost' } },
    });

    const failure = await teach(db).catch((err: unknown) => err);

    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(HttpException);
    expect((failure as Error).message).toBe(
      `Could not read the Workshops taught by ${ME}: connection lost`,
    );
  });
});
