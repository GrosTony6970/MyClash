import { describe, expect, it, vi } from 'vitest';
import type { MyEvent } from '../../me/me-events.service';
import { myEvents } from './my-events';
import { expectNoRawIds } from './no-raw-ids.test-helper';

const U = (n: number) => `0000000${n}-aaaa-4bbb-8ccc-00000000000${n}`;

// A service row with an id in every place the real one carries one.
const entry = {
  event: {
    id: U(1),
    slug: 'fal-2026',
    name: 'FAL 2026',
    startDate: '2026-03-14',
    endDate: '2026-03-15',
    status: 'published',
    timezone: 'Europe/Paris',
    kind: 'tournament',
    photoMode: null,
  },
  roles: {
    isCompetitor: true,
    isReferee: true,
    isWorkshopParticipant: false,
    isInstructor: true,
  },
  tournaments: [
    {
      id: U(2),
      slug: 'longsword',
      name: 'Longsword',
      weapon: 'longsword',
      registered: true,
      registrationId: U(3),
      poolName: 'Pool 2',
      swissRoundsCompleted: null,
      swissRoundCount: null,
      seed: 4,
      bibNumber: 12,
    },
  ],
  refereeOf: [
    {
      id: U(4),
      tournamentName: 'Longsword',
      poolName: 'Pool 1',
      role: 'custom-0a1b2c3d-x9z',
      skillName: 'Director',
      skillColor: '#fff',
      liceName: 'Lice A',
      venueName: 'Hall',
      matchKind: 'pool',
      roundOfCount: null,
      swissRound: null,
      bracketSlotId: U(5),
      startsAt: '2026-03-14T09:00:00Z',
      endsAt: null,
    },
  ],
  workshopsTeaching: [
    {
      workshopId: U(6),
      sessionId: U(7),
      workshopSlug: 'grappling',
      workshopName: 'Grappling',
      sessionStart: '2026-03-14T14:00:00Z',
      sessionEnd: '2026-03-14T15:00:00Z',
      location: 'Room 3',
      sessionCancelled: false,
    },
  ],
  counts: { matches: 3, refereeSlots: 1, workshops: 1 },
} as unknown as MyEvent;

describe('my_events', () => {
  it('maps each Event to names and slugs, with no id', async () => {
    const listMyEvents = vi.fn().mockResolvedValue([entry]);
    const result = await myEvents({ userId: 'user-1', email: 'a@b.c', clientId: 'c' }, {
      meEvents: { listMyEvents },
    } as never);

    expect(listMyEvents).toHaveBeenCalledWith({ userId: 'user-1', staff: null });
    expect(result).toEqual({
      events: [
        {
          name: 'FAL 2026',
          slug: 'fal-2026',
          startDate: '2026-03-14',
          endDate: '2026-03-15',
          status: 'published',
          kind: 'tournament',
          roles: ['fighter', 'referee', 'instructor'],
          tournaments: [
            {
              name: 'Longsword',
              slug: 'longsword',
              weapon: 'longsword',
              registered: true,
              poolName: 'Pool 2',
            },
          ],
          refereeOf: [
            {
              tournamentName: 'Longsword',
              poolName: 'Pool 1',
              role: 'Director',
              liceName: 'Lice A',
            },
          ],
          teaching: [
            {
              workshopName: 'Grappling',
              start: '2026-03-14T14:00:00Z',
              end: '2026-03-14T15:00:00Z',
              location: 'Room 3',
              cancelled: false,
            },
          ],
        },
      ],
    });
    expectNoRawIds(result);
  });
});
