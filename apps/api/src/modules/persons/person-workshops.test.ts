import { HttpException } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { filtersFor, mockSupabase, selectsFor } from '../../common/testing/supabase-chain';
import { readPersonWorkshops } from './person-workshops';

const TOM = 'p-tom';

/** One booking of a session, as the read embeds it. */
const booking = (person: string, session: string, status: string) => ({
  user_id: person,
  status,
  workshop_sessions: {
    id: session,
    starts_at: '2027-05-22T12:00:00+00:00',
    ends_at: '2027-05-22T13:00:00+00:00',
    location_label: 'Hall B',
    workshops: { title: `Workshop ${session}`, slug: `workshop-${session}` },
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

const read = (db: ReturnType<typeof mockSupabase>, own: boolean) =>
  readPersonWorkshops({ from: db.from } as unknown as SupabaseClient, TOM, own);

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
    });
  });

  it('asks the database for the status, for this person, and only for the states the reader may know', async () => {
    const own = seeded();
    await read(own, true);
    const [select] = selectsFor(own.from, 'workshop_enrollments');
    expect(select?.replace(/\s+/g, ' ').trim()).toBe(
      'status, workshop_sessions ( id, starts_at, ends_at, location_label, workshops ( title, slug ) )',
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
