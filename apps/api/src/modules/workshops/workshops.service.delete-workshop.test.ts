/**
 * An organiser deletes a Workshop nobody is booked on (operator ruling, 2026-11-09).
 *
 * No screen and no route could delete a Workshop: one created by mistake stayed for good. It now
 * can, while nobody holds a seat, a place on the waitlist or an intent. With bookings it is refused
 * by name: the organiser removes its session first, which tells those people.
 *
 * Driven through the real service over seeded tables.
 */
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { mockSupabase, writesTo, type TableSeed } from '../../common/testing/supabase-chain';
import { OrganizationsService } from '../organizations/organizations.service';
import { WorkshopsService } from './workshops.service';

const EVENT = '11111111-1111-4111-8111-111111111111';
const WORKSHOP = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const LEAD = 'u-lead';

/** The photo bucket: each removal notes how many Workshop deletes had run by then. */
function photoBucket(removeError?: string) {
  const removals: Array<{ keys: string[]; workshopDeletesBefore: number }> = [];
  let db: ReturnType<typeof mockSupabase> | null = null;
  const bucket = {
    list: vi.fn(async () => ({ data: [{ name: 'photo-1.jpg' }], error: null })),
    remove: vi.fn(async (keys: string[]) => {
      removals.push({ keys, workshopDeletesBefore: db ? deletes(db).length : -1 });
      return { data: [], error: removeError ? { message: removeError } : null };
    }),
  };
  const storage = { from: vi.fn(() => bucket) };
  return { storage, removals, watch: (d: ReturnType<typeof mockSupabase>) => (db = d) };
}

let photos: ReturnType<typeof photoBucket>;

function build(
  bookings: Array<{ status: string }>,
  overrides: Record<string, TableSeed> = {},
  bucket = photoBucket(),
) {
  photos = bucket;
  const db = mockSupabase({
    events: { rows: [{ id: EVENT, organization_id: 'org-a', status: 'published' }] },
    workshops: { rows: [{ id: WORKSHOP, event_id: EVENT }] },
    workshop_instructors: {
      rows: [
        { id: 'wi-paul', workshop_id: WORKSHOP },
        // Another Workshop's line: its photo stays.
        { id: 'wi-other', workshop_id: 'w-other' },
      ],
    },
    workshop_sessions: { rows: [{ id: 's-1', workshop_id: WORKSHOP }] },
    workshop_enrollments: {
      rows: bookings.map((b, i) => ({
        id: `e-${i}`,
        workshop_session_id: 's-1',
        user_id: `p-${i}`,
        ...b,
      })),
    },
    organization_members: {
      rows: [
        { organization_id: 'org-a', user_id: LEAD, role: 'workshop_lead' },
        { organization_id: 'org-a', user_id: 'u-reader', role: 'read_only' },
      ],
    },
    ...overrides,
  });
  bucket.watch(db);
  const supabase = { service: { ...db.service, storage: bucket.storage } };
  const service = new WorkshopsService(
    supabase as never,
    {} as never,
    {} as never,
    new OrganizationsService(supabase as never),
    {} as never,
    {} as never,
  );
  return { db, service };
}

const deletes = (db: ReturnType<typeof mockSupabase>) =>
  writesTo(db, 'workshops').filter((write) => write.op === 'delete');

describe('deleting a Workshop', () => {
  it.each([
    ['nobody ever booked', []],
    [
      'only refused and cancelled bookings are left',
      [{ status: 'refused' }, { status: 'cancelled' }],
    ],
  ])('deletes it when %s', async (_, bookings) => {
    const { db, service } = build(bookings);

    await service.deleteWorkshop(WORKSHOP, LEAD);

    expect(deletes(db)).toHaveLength(1);
  });

  it('deletes a Workshop with no session', async () => {
    const { db, service } = build([], { workshop_sessions: { rows: [] } });

    await service.deleteWorkshop(WORKSHOP, LEAD);

    expect(deletes(db)).toHaveLength(1);
  });

  it.each(['confirmed', 'waitlisted', 'intent'])(
    'refuses by name while a %s booking remains, deleting nothing',
    async (status) => {
      const { db, service } = build([{ status }]);

      const refusal = await service.deleteWorkshop(WORKSHOP, LEAD).catch((e: unknown) => e);

      expect(refusal).toBeInstanceOf(ConflictException);
      // The exception filter sends `error` as the code WORKSHOP_HAS_BOOKINGS.
      expect((refusal as ConflictException).getResponse()).toMatchObject({
        error: 'WorkshopHasBookings',
      });
      expect(deletes(db)).toEqual([]);
    },
  );

  it('refuses a member below workshop lead, deleting nothing', async () => {
    const { db, service } = build([]);

    await expect(service.deleteWorkshop(WORKSHOP, 'u-reader')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(deletes(db)).toEqual([]);
  });

  it("deletes its instructors' photos before it, or nothing would name them (3.6)", async () => {
    const { db, service } = build([]);

    await service.deleteWorkshop(WORKSHOP, LEAD);

    expect(photos.removals).toEqual([
      { keys: ['workshop_instructors/wi-paul/photo-1.jpg'], workshopDeletesBefore: 0 },
    ]);
    expect(deletes(db)).toHaveLength(1);
  });

  it('refuses when a photo could not be deleted, deleting nothing', async () => {
    const { db, service } = build([], {}, photoBucket('timeout'));

    await expect(service.deleteWorkshop(WORKSHOP, LEAD)).rejects.toThrow('timeout');
    expect(deletes(db)).toEqual([]);
  });

  it('answers a count that failed as a failure, not as nobody', async () => {
    const { db, service } = build([], {
      workshop_enrollments: { data: null, error: { message: 'reset' } },
    });

    await expect(service.deleteWorkshop(WORKSHOP, LEAD)).rejects.toThrow('reset');
    expect(deletes(db)).toEqual([]);
  });
});
