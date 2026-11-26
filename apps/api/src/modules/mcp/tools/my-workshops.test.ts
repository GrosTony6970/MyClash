import { describe, expect, it, vi } from 'vitest';
import { myWorkshops } from './my-workshops';
import { expectNoRawIds } from './no-raw-ids.test-helper';

const caller = { userId: 'user-1', email: 'a@b.c', clientId: 'c' };
const ID = '00000001-aaaa-4bbb-8ccc-000000000001';
const event = {
  id: ID,
  slug: 'fal-2026',
  name: 'FAL 2026',
  timezone: 'Europe/Paris',
  startDate: '2026-03-14',
};

const teachingGroups = [
  {
    event,
    myGlobalPersonId: ID,
    workshops: [
      {
        id: ID,
        slug: 'half-sword',
        title: 'Half-sword',
        level: 'beginner',
        weapon: 'Longsword',
        descriptionMd: 'long text',
        instructors: [{ globalPersonId: ID, displayName: 'Me' }],
        sessions: [
          {
            id: ID,
            startsAt: '2026-03-14T10:00:00Z',
            endsAt: '2026-03-14T11:00:00Z',
            status: 'cancelled',
            locationLabel: 'Hall B',
            venue: { name: 'Gym' },
            area: { name: 'Mat 2' },
            capacity: 20,
            confirmedCount: 12,
            waitlistCount: 3,
          },
          {
            id: ID,
            startsAt: '2026-03-15T10:00:00Z',
            endsAt: null,
            status: 'scheduled',
            locationLabel: '',
            venue: { name: 'Gym' },
            area: null,
            capacity: null,
            confirmedCount: 0,
            waitlistCount: 0,
          },
        ],
      },
    ],
  },
];

const attendedGroups = [
  {
    event,
    workshops: [
      {
        id: ID,
        slug: 'dagger',
        title: 'Dagger',
        level: null,
        weapon: 'Dagger',
        instructors: [{ globalPersonId: ID, displayName: 'Jeanne Martin' }],
        sessions: [
          {
            id: ID,
            startsAt: '2026-03-14T14:00:00Z',
            endsAt: '2026-03-14T15:00:00Z',
            locationLabel: null,
            venue: null,
            area: { name: 'Mat 1' },
            capacity: 10,
            confirmedCount: 0,
            status: 'scheduled',
          },
        ],
      },
    ],
  },
];

describe('my_workshops', () => {
  it('maps what the person teaches and attends, by name and time', async () => {
    const getInstructorWorkshops = vi.fn().mockResolvedValue(teachingGroups);
    const getMyWorkshopHistory = vi.fn().mockResolvedValue(attendedGroups);
    const result = await myWorkshops(caller, {
      meEvents: { getInstructorWorkshops, getMyWorkshopHistory },
    } as never);

    expect(getInstructorWorkshops).toHaveBeenCalledWith('user-1');
    expect(getMyWorkshopHistory).toHaveBeenCalledWith('user-1');
    expect(result).toEqual({
      teaching: [
        {
          eventName: 'FAL 2026',
          eventSlug: 'fal-2026',
          timezone: 'Europe/Paris',
          name: 'Half-sword',
          level: 'beginner',
          weapon: 'Longsword',
          sessions: [
            {
              start: '2026-03-14T10:00:00Z',
              end: '2026-03-14T11:00:00Z',
              location: { label: 'Hall B', venue: 'Gym', area: 'Mat 2' },
              cancelled: true,
              confirmed: 12,
              waitlisted: 3,
              capacity: 20,
            },
            {
              start: '2026-03-15T10:00:00Z',
              end: null,
              location: { label: null, venue: 'Gym', area: null },
              cancelled: false,
              confirmed: 0,
              waitlisted: 0,
              capacity: null,
            },
          ],
        },
      ],
      attended: [
        {
          eventName: 'FAL 2026',
          eventSlug: 'fal-2026',
          timezone: 'Europe/Paris',
          name: 'Dagger',
          level: null,
          weapon: 'Dagger',
          instructors: ['Jeanne Martin'],
          sessions: [
            {
              start: '2026-03-14T14:00:00Z',
              end: '2026-03-14T15:00:00Z',
              location: { label: null, venue: null, area: 'Mat 1' },
            },
          ],
        },
      ],
    });
    expectNoRawIds(result);
  });

  it('answers empty lists for a person with no Workshops', async () => {
    const result = await myWorkshops(caller, {
      meEvents: {
        getInstructorWorkshops: vi.fn().mockResolvedValue([]),
        getMyWorkshopHistory: vi.fn().mockResolvedValue([]),
      },
    } as never);
    expect(result).toEqual({ teaching: [], attended: [] });
  });
});
